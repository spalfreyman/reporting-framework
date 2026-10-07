import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readConfiguration } from '../env.js';
import { createCustomObjectPort } from '../ct/client.js';
import { RegistryCache, timezoneDrift } from '../registry/registry.js';
import { resolveReports } from '../reports/resolve.js';
import { runReport, type RunReportRequest } from '../run-report.js';
import { SourceClient } from '../sources/source-client.js';
import { MemoryCache } from '../cache/memory.js';
import { accessMiddleware, requirePermission } from '../middleware/context.js';
import { sessionMiddleware } from '../middleware/session.js';
import { reportAvailability } from '../shared/planner/plan.js';
import { CO } from '../shared/schema/descriptor.js';
import { formatDay } from '../shared/util/date-range.js';
import { filterSchema } from '../shared/schema/query.js';
import { reportDefinitionSchema } from '../shared/schema/report-definition.js';
import { z } from 'zod';
import type { Env } from '../http-context.js';
import type { Logger } from '../logger.js';
import type { TileResult } from '../run-report.js';

/**
 * Route wiring.
 *
 * /status mounts BEFORE the session middleware, because a liveness probe has no Merchant
 * Center session. Everything else mounts after it, so no route can accidentally be reached
 * without a verified token: Hono runs matched handlers in registration order, and the status
 * handler returns without calling `next`, so the auth chain never runs for it.
 */

const runRequestSchema = z.object({
  datePreset: z.string().optional(),
  range: z.object({ from: z.string(), to: z.string() }).optional(),
  grain: z.enum(['hour', 'day', 'week', 'month', 'quarter', 'year']).optional(),
  compare: z.enum(['previousPeriod', 'previousYear', 'none']).optional(),
  filters: z.array(filterSchema).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

const parseBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
  const body = await c.req.json().catch(() => ({}));
  return (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
};

export const createRouter = (log: Logger): Hono<Env> => {
  const config = readConfiguration();
  const port = createCustomObjectPort();
  const registry = new RegistryCache(port, log);
  const cache = new MemoryCache<TileResult>(500);
  const sourceClient = new SourceClient({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    timeoutMs: config.QUERY_TIMEOUT_MS,
    log,
  });

  const router = new Hono<Env>();

  // ── Unauthenticated liveness ───────────────────────────────────────────────
  router.get('/status', (c) => c.json({ status: 'ok', service: 'reporting-gateway' }));

  // ── Everything below requires a verified Merchant Center session ───────────
  router.use(
    '*',
    sessionMiddleware(),
    accessMiddleware(),
    requirePermission(config.REPORTING_REQUIRED_PERMISSION)
  );

  /** The report catalogue, framed by the subject's access and the installed sources. */
  router.get('/reports', async (c) => {
    const [{ reports, problems }, { sources, invalid }] = await Promise.all([
      resolveReports(port, c.get('log') ?? log),
      registry.get(),
    ]);

    const framed = reports
      .map((report) => ({ report, availability: reportAvailability(report, c.get('access')!, sources) }))
      // A report hidden by PERMISSIONS is omitted entirely — report titles can themselves be
      // sensitive. One blocked only by a missing connector is surfaced with a reason, so the
      // UI can say "install a web analytics source to enable this".
      .filter((entry) => entry.availability.state !== 'hidden')
      .map(({ report, availability }) => ({
        id: report.id,
        version: report.version,
        origin: report.origin,
        category: report.category,
        titleKey: report.titleKey,
        title: report.title,
        descriptionKey: report.descriptionKey,
        description: report.description,
        audience: report.audience,
        availability,
        defaults: report.defaults,
        allowedFilters: report.allowedFilters,
      }));

    return c.json({
      reports: framed,
      problems,
      registry: { sources: sources.map((s) => s.sourceId), invalid },
    });
  });

  /**
   * A single report's full definition, including tile layout and chart specs.
   *
   * The Merchant Center app needs these to render, and resolving them here rather than in the
   * app keeps ONE resolution path — built-ins from code, overlaid by stored Custom Objects,
   * migrated on read. Duplicating that in the client would guarantee drift.
   */
  router.get('/reports/:reportId', async (c) => {
    const { byId } = await resolveReports(port, c.get('log') ?? log);
    const report = byId[c.req.param('reportId')];
    const { sources } = await registry.get();

    if (!report) {
      return c.json({ error: 'NOT_FOUND', message: 'Unknown report.' }, 404);
    }

    const availability = reportAvailability(report, c.get('access')!, sources);
    if (availability.state === 'hidden') {
      // Indistinguishable from a genuinely unknown report, so probing cannot enumerate reports
      // this subject is not allowed to know exist.
      return c.json({ error: 'NOT_FOUND', message: 'Unknown report.' }, 404);
    }

    return c.json({ report, availability });
  });

  /** Run a report. One round trip per report, not per tile. */
  router.post('/reports/:reportId/run', bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
    const parsed = runRequestSchema.safeParse(await parseBody(c));
    if (!parsed.success) {
      return c.json(
        {
          error: 'BAD_REQUEST',
          message: 'The report run request is malformed.',
          correlationId: c.get('correlationId'),
        },
        400
      );
    }

    const { byId } = await resolveReports(port, c.get('log') ?? log);
    const report = byId[c.req.param('reportId')];
    const { sources } = await registry.get();

    if (!report) {
      return c.json({ error: 'NOT_FOUND', message: 'Unknown report.' }, 404);
    }

    const availability = reportAvailability(report, c.get('access')!, sources);
    if (availability.state === 'hidden') {
      // Same shape as a genuinely unknown report, so probing cannot enumerate reports the
      // subject is not allowed to know exist.
      return c.json({ error: 'NOT_FOUND', message: 'Unknown report.' }, 404);
    }

    const epoch = await port.get<{ restatementEpoch?: number }>(CO.config, CO.keys.epoch);

    const result = await runReport(report, parsed.data as RunReportRequest, c.get('access')!, sources, {
      sourceClient,
      cache,
      log: c.get('log') ?? log,
      today: formatDay(Date.now()),
      registryVersion: String((await registry.get()).loadedAt),
      restatementEpoch: epoch?.value.restatementEpoch ?? 0,
      ttlTodaySeconds: config.CACHE_TTL_TODAY_SECONDS,
      ttlSealedSeconds: config.CACHE_TTL_SEALED_SECONDS,
      maxConcurrency: config.MAX_SOURCE_CONCURRENCY,
      onStaleDescriptor: async () => (await registry.invalidate()).sources,
    });

    return c.json(result);
  });

  /**
   * Runs an UNSAVED report definition posted in the body — the report builder's live preview.
   *
   * It runs through the exact same framed pipeline as a saved report (access frame from the
   * verified session, same planner, same merge), so the preview is faithful: what you see here
   * is what the saved report will show, for this user. Requires ManageBuilder, since it is an
   * authoring tool.
   */
  router.post(
    '/reports/preview',
    bodyLimit({ maxSize: 1024 * 1024 }),
    requirePermission('ManageBuilder'),
    async (c) => {
      const body = await parseBody(c);
      const parsed = reportDefinitionSchema.safeParse(body.definition);
      if (!parsed.success) {
        return c.json(
          {
            error: 'BAD_REPORT_DEFINITION',
            message: 'The draft report definition is invalid.',
            issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
            correlationId: c.get('correlationId'),
          },
          400
        );
      }

      const runRequest = runRequestSchema.safeParse(body.request ?? {});
      const { sources } = await registry.get();
      const epoch = await port.get<{ restatementEpoch?: number }>(CO.config, CO.keys.epoch);

      const result = await runReport(
        parsed.data,
        (runRequest.success ? runRequest.data : {}) as RunReportRequest,
        c.get('access')!,
        sources,
        {
          sourceClient,
          cache,
          log: c.get('log') ?? log,
          today: formatDay(Date.now()),
          registryVersion: String((await registry.get()).loadedAt),
          restatementEpoch: epoch?.value.restatementEpoch ?? 0,
          ttlTodaySeconds: config.CACHE_TTL_TODAY_SECONDS,
          ttlSealedSeconds: config.CACHE_TTL_SEALED_SECONDS,
          maxConcurrency: config.MAX_SOURCE_CONCURRENCY,
          onStaleDescriptor: async () => (await registry.invalidate()).sources,
        }
      );
      return c.json(result);
    }
  );

  /** Installed data sources, for the admin page. */
  router.get('/datasources', async (c) => {
    const { sources, invalid, loadedAt } = await registry.get();
    const drift = timezoneDrift(sources);
    return c.json({
      sources,
      invalid,
      loadedAt: new Date(loadedAt).toISOString(),
      // Surfaced loudly rather than left to produce quietly wrong cross-source charts.
      timezoneDrift: drift.consistent
        ? null
        : {
            message:
              'Installed data sources disagree on their reporting timezone. Cross-source ' +
              'day-grain reports cannot be aligned until this is resolved.',
            byTimezone: drift.byTimezone,
          },
    });
  });

  return router;
};
