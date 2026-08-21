import { Router, type Request, type Response } from 'express';
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
import type { Logger } from '../logger.js';
import type { TileResult } from '../run-report.js';

/**
 * Route wiring.
 *
 * /status mounts BEFORE the session middleware, because a liveness probe has no Merchant
 * Center session. Everything else mounts after it, so no route can accidentally be reached
 * without a verified token.
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

export const createRouter = (log: Logger): Router => {
  const config = readConfiguration();
  const port = createCustomObjectPort();
  const registry = new RegistryCache(port, log);
  const cache = new MemoryCache<TileResult>(500);
  const sourceClient = new SourceClient({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    timeoutMs: config.QUERY_TIMEOUT_MS,
    log,
  });

  const router = Router();

  // ── Unauthenticated liveness ───────────────────────────────────────────────
  router.get("/status", (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'reporting-gateway' });
  });

  // ── Everything below requires a verified Merchant Center session ───────────
  router.use(sessionMiddleware());
  router.use(accessMiddleware());
  router.use(requirePermission(config.REPORTING_REQUIRED_PERMISSION));

  /** The report catalogue, framed by the subject's access and the installed sources. */
  router.get('/reports', async (req: Request, res: Response, next) => {
    try {
      const [{ reports, problems }, { sources, invalid }] = await Promise.all([
        resolveReports(port, req.log ?? log),
        registry.get(),
      ]);

      const framed = reports
        .map((report) => ({ report, availability: reportAvailability(report, req.access!, sources) }))
        // A report hidden by PERMISSIONS is omitted entirely — report titles can themselves
        // be sensitive. One blocked only by a missing connector is surfaced with a reason,
        // so the UI can say "install a web analytics source to enable this".
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

      res.json({
        reports: framed,
        problems,
        registry: { sources: sources.map((s) => s.sourceId), invalid },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * A single report's full definition, including tile layout and chart specs.
   *
   * The Merchant Center app needs these to render, and resolving them here rather than in
   * the app keeps ONE resolution path — built-ins from code, overlaid by stored Custom
   * Objects, migrated on read. Duplicating that in the client would guarantee drift.
   */
  router.get('/reports/:reportId', async (req: Request, res: Response, next) => {
    try {
      const { byId } = await resolveReports(port, req.log ?? log);
      const report = byId[req.params.reportId];
      const { sources } = await registry.get();

      if (!report) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown report.' });
        return;
      }

      const availability = reportAvailability(report, req.access!, sources);
      if (availability.state === 'hidden') {
        // Indistinguishable from a genuinely unknown report, so probing cannot enumerate
        // reports this subject is not allowed to know exist.
        res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown report.' });
        return;
      }

      res.json({ report, availability });
    } catch (error) {
      next(error);
    }
  });

  /** Run a report. One round trip per report, not per tile. */
  router.post('/reports/:reportId/run', async (req: Request, res: Response, next) => {
    try {
      const parsed = runRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'The report run request is malformed.',
          correlationId: req.correlationId,
        });
        return;
      }

      const { byId } = await resolveReports(port, req.log ?? log);
      const report = byId[req.params.reportId];
      const { sources } = await registry.get();

      if (!report) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown report.' });
        return;
      }

      const availability = reportAvailability(report, req.access!, sources);
      if (availability.state === 'hidden') {
        // Same shape as a genuinely unknown report, so probing cannot enumerate reports the
        // subject is not allowed to know exist.
        res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown report.' });
        return;
      }

      const epoch = await port.get<{ restatementEpoch?: number }>(CO.config, CO.keys.epoch);

      const result = await runReport(
        report,
        parsed.data as RunReportRequest,
        req.access!,
        sources,
        {
          sourceClient,
          cache,
          log: req.log ?? log,
          today: formatDay(Date.now()),
          registryVersion: String((await registry.get()).loadedAt),
          restatementEpoch: epoch?.value.restatementEpoch ?? 0,
          ttlTodaySeconds: config.CACHE_TTL_TODAY_SECONDS,
          ttlSealedSeconds: config.CACHE_TTL_SEALED_SECONDS,
          maxConcurrency: config.MAX_SOURCE_CONCURRENCY,
          onStaleDescriptor: async () => (await registry.invalidate()).sources,
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Runs an UNSAVED report definition posted in the body — the report builder's live preview.
   *
   * It runs through the exact same framed pipeline as a saved report (access frame from the
   * verified session, same planner, same merge), so the preview is faithful: what you see
   * here is what the saved report will show, for this user. Requires ManageBuilder, since it
   * is an authoring tool.
   */
  router.post('/reports/preview', requirePermission('ManageBuilder'), async (req, res, next) => {
    try {
      const parsed = reportDefinitionSchema.safeParse((req.body ?? {}).definition);
      if (!parsed.success) {
        res.status(400).json({
          error: 'BAD_REPORT_DEFINITION',
          message: 'The draft report definition is invalid.',
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          correlationId: req.correlationId,
        });
        return;
      }

      const runRequest = runRequestSchema.safeParse((req.body ?? {}).request ?? {});
      const { sources } = await registry.get();
      const epoch = await port.get<{ restatementEpoch?: number }>(CO.config, CO.keys.epoch);

      const result = await runReport(
        parsed.data,
        (runRequest.success ? runRequest.data : {}) as RunReportRequest,
        req.access!,
        sources,
        {
          sourceClient,
          cache,
          log: req.log ?? log,
          today: formatDay(Date.now()),
          registryVersion: String((await registry.get()).loadedAt),
          restatementEpoch: epoch?.value.restatementEpoch ?? 0,
          ttlTodaySeconds: config.CACHE_TTL_TODAY_SECONDS,
          ttlSealedSeconds: config.CACHE_TTL_SEALED_SECONDS,
          maxConcurrency: config.MAX_SOURCE_CONCURRENCY,
          onStaleDescriptor: async () => (await registry.invalidate()).sources,
        }
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** Installed data sources, for the admin page. */
  router.get('/datasources', async (_req: Request, res: Response, next) => {
    try {
      const { sources, invalid, loadedAt } = await registry.get();
      const drift = timezoneDrift(sources);
      res.json({
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
    } catch (error) {
      next(error);
    }
  });

  return router;
};
