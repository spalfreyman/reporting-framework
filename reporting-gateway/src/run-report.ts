import { randomUUID } from 'node:crypto';
import type { DataSourceDescriptor } from './shared/schema/descriptor.js';
import type { ReportDefinition } from './shared/schema/report-definition.js';
import type { ResultSet, SourceQuery } from './shared/schema/query.js';
import { mergeResults, type MergeNotice, type MergeResult } from './shared/planner/merge.js';
import { planReport, type PlanNotice, type TilePlan } from './shared/planner/plan.js';
import { cacheKey, decideTtl } from './shared/planner/cache-key.js';
import { resolveComparison, resolvePreset } from './shared/util/date-range.js';
import { stableHash } from './shared/util/hash.js';
import type { DateRange, Filter } from './shared/schema/query.js';
import type { Grain } from './shared/semantic/types.js';
import type { EffectiveAccess } from './shared/framing/access.js';
import { SourceCallError, SourceClient, verifyScope } from './sources/source-client.js';
import { MemoryCache } from './cache/memory.js';
import type { Logger } from './logger.js';
import { isCapabilityError } from './shared/schema/query.js';

/**
 * Runs a report: plan, fan out, merge, derive, cache.
 *
 * One HTTP round trip per REPORT, not per tile — a twelve-tile dashboard should cost one
 * request, not twelve.
 */

export interface RunReportRequest {
  reportId: string;
  datePreset?: string;
  range?: DateRange;
  grain?: Grain;
  compare?: 'previousPeriod' | 'previousYear' | 'none';
  filters?: Filter[];
  timezone?: string;
  locale?: string;
}

export interface TileResult {
  tileId: string;
  status: 'ok' | 'partial' | 'degraded' | 'unavailable';
  columns: MergeResult['columns'];
  rows: MergeResult['rows'];
  totals: MergeResult['totals'];
  comparison?: { range: DateRange; rows: MergeResult['rows']; totals: MergeResult['totals'] };
  effectiveGrain: Grain | null;
  unavailableMetrics: TilePlan['unavailableMetrics'];
  provenance: Array<{ metric: string; sourceId: string | null; rule: string }>;
  contributions: MergeResult['contributions'];
  dataAsOf: string | null;
  notices: Array<PlanNotice | MergeNotice>;
  cacheHit: boolean;
}

export interface RunReportResult {
  reportId: string;
  reportVersion: number;
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  range: DateRange;
  compareRange: DateRange | null;
  grain: Grain;
  tiles: TileResult[];
  notices: PlanNotice[];
  /** MIN across every contributing source, not the freshest. */
  dataAsOf: string | null;
  registrySources: string[];
}

export interface RunnerDeps {
  sourceClient: SourceClient;
  cache: MemoryCache<TileResult>;
  log: Logger;
  today: string;
  registryVersion: string;
  restatementEpoch: number;
  ttlTodaySeconds: number;
  ttlSealedSeconds: number;
  maxConcurrency: number;
  onStaleDescriptor: () => Promise<DataSourceDescriptor[]>;
}

/** Bounded-concurrency map, so a wide report cannot open 40 sockets at once. */
const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

const toSourceQuery = (
  plan: TilePlan,
  subQuery: TilePlan['subQueries'][number],
  range: DateRange,
  request: { projectKey: string; timezone: string; requestId: string; budgetMs: number }
): SourceQuery => ({
  protocolVersion: 1,
  requestId: request.requestId,
  projectKey: request.projectKey,
  metrics: subQuery.metrics,
  dimensions: subQuery.dimensions,
  grain: subQuery.pointInTime ? null : (subQuery.grain ?? plan.effectiveGrain),
  ...(subQuery.pointInTime ? {} : { timeRange: range }),
  timezone: request.timezone,
  filters: subQuery.filters,
  scope: subQuery.scope,
  orderBy: [],
  limit: 5000,
  budgetMs: request.budgetMs,
});

export const runReport = async (
  report: ReportDefinition,
  request: RunReportRequest,
  access: EffectiveAccess,
  sources: DataSourceDescriptor[],
  deps: RunnerDeps
): Promise<RunReportResult> => {
  const runId = randomUUID();
  const log = deps.log.child({ reportId: report.id, runId });

  const grain = request.grain ?? report.defaults.grain;
  const timezone = request.timezone ?? 'UTC';
  const preset = (request.datePreset ?? report.defaults.datePreset) as
    | Parameters<typeof resolvePreset>[0]
    | 'custom';

  const range =
    request.range ?? (preset === 'custom'
      ? resolvePreset('last28d', deps.today, report.defaults.weekStart)
      : resolvePreset(preset, deps.today, report.defaults.weekStart));

  const compareKind = request.compare ?? report.defaults.comparison.kind;
  const compareRange = resolveComparison(range, compareKind, report.defaults.comparison.alignBy);

  const plan = planReport(report, {
    projectKey: access.subject.projectKey,
    today: deps.today,
    timezone,
    weekStart: report.defaults.weekStart,
    range,
    ...(compareRange ? { compareTo: compareRange } : {}),
    grain,
    filters: [...report.defaults.filters, ...(request.filters ?? [])],
    access,
    sources,
  });

  const fxPolicyHash = stableHash(report.defaults.fx);

  const runTile = async (tilePlan: TilePlan): Promise<TileResult> => {
    const tileLog = log.child({ tileId: tilePlan.tileId });
    const definition = report.tiles.find((t) => t.id === tilePlan.tileId)!;

    const key = cacheKey({
      protocolVersion: 1,
      projectKey: access.subject.projectKey,
      reportId: report.id,
      reportVersion: report.version,
      tileId: tilePlan.tileId,
      metrics: definition.query.metrics,
      dimensions: definition.query.dimensions,
      grain: tilePlan.effectiveGrain,
      timezone,
      range,
      ...(compareRange ? { compareTo: compareRange } : {}),
      filters: [...report.defaults.filters, ...(request.filters ?? []), ...definition.query.filters],
      // Scope is IN the key. Omit it and one subject's cached tile leaks to another.
      scopeHash: access.hash,
      sourceSelectionHash: tilePlan.sourceSelectionHash,
      fxPolicyHash,
      registryVersion: deps.registryVersion,
      restatementEpoch: deps.restatementEpoch,
      locale: request.locale ?? access.subject.locale,
    });

    const cached = deps.cache.get(key);
    if (cached && !cached.stale) return { ...cached.value, cacheHit: true };

    if (!tilePlan.renderable || tilePlan.subQueries.length === 0) {
      return {
        tileId: tilePlan.tileId,
        status: 'unavailable',
        columns: [],
        rows: [],
        totals: {},
        effectiveGrain: tilePlan.effectiveGrain,
        unavailableMetrics: tilePlan.unavailableMetrics,
        provenance: tilePlan.assignments.map((a) => ({
          metric: a.metric,
          sourceId: a.sourceId,
          rule: a.rule,
        })),
        contributions: [],
        dataAsOf: null,
        notices: tilePlan.notices,
        cacheHit: false,
      };
    }

    const notices: Array<PlanNotice | MergeNotice> = [...tilePlan.notices];

    const fetchFor = async (
      forRange: DateRange
    ): Promise<Array<{ sourceId: string; resultSet: ResultSet }>> => {
      const gathered = await mapLimit(tilePlan.subQueries, deps.maxConcurrency, async (subQuery) => {
        const descriptor = sources.find((s) => s.sourceId === subQuery.sourceId);
        if (!descriptor) return null;

        const query = toSourceQuery(tilePlan, subQuery, forRange, {
          projectKey: access.subject.projectKey,
          timezone,
          requestId: `${runId}:${tilePlan.tileId}:${subQuery.sourceId}`,
          budgetMs: 20_000,
        });

        try {
          const resultSet = await deps.sourceClient.query(descriptor, query, tileLog);

          const scopeCheck = verifyScope(resultSet, subQuery.scope);
          if (!scopeCheck.ok) {
            // A source that gets scope wrong cannot be trusted to have got the rest right.
            deps.sourceClient.trip(descriptor.sourceId);
            tileLog.error('scope violation — discarding response and circuit-breaking source', {
              sourceId: descriptor.sourceId,
              violation: scopeCheck.violation,
            });
            notices.push({
              severity: 'error',
              code: 'SCOPE_VIOLATION',
              message: `Data from ${descriptor.sourceId} was rejected: ${scopeCheck.violation}.`,
            });
            return null;
          }

          if (resultSet.flags.degradedReason) {
            notices.push({
              severity: 'warning',
              code: 'SOURCE_DEGRADED',
              message: `${descriptor.sourceId}: ${resultSet.flags.degradedReason}${
                resultSet.flags.detail ? ` (${resultSet.flags.detail})` : ''
              }`,
            });
          }

          return { sourceId: subQuery.sourceId, resultSet };
        } catch (error) {
          if (!(error instanceof SourceCallError)) throw error;

          if (isCapabilityError(error.detail.code)) {
            // The planner acted on a stale descriptor. Refresh it so the next request plans
            // correctly, but never retry this call blindly.
            tileLog.warn('capability error — refreshing the descriptor registry', {
              sourceId: subQuery.sourceId,
              code: error.detail.code,
            });
            await deps.onStaleDescriptor();
          }

          notices.push({
            severity: 'warning',
            code: error.detail.code,
            message:
              error.detail.code === 'QUOTA_EXCEEDED'
                ? `${subQuery.sourceId} is rate-limited; showing what is available.`
                : `${subQuery.sourceId} is unavailable: ${error.detail.message}`,
          });
          return null;
        }
      });

      return gathered.filter((entry): entry is { sourceId: string; resultSet: ResultSet } =>
        Boolean(entry)
      );
    };

    const primary = await fetchFor(range);

    if (primary.length === 0) {
      return {
        tileId: tilePlan.tileId,
        status: 'unavailable',
        columns: [],
        rows: [],
        totals: {},
        effectiveGrain: tilePlan.effectiveGrain,
        unavailableMetrics: tilePlan.unavailableMetrics,
        provenance: tilePlan.assignments.map((a) => ({
          metric: a.metric,
          sourceId: a.sourceId,
          rule: a.rule,
        })),
        contributions: [],
        dataAsOf: null,
        notices,
        cacheHit: false,
      };
    }

    const mergeOptions = {
      joinKey: tilePlan.joinKey,
      baseMetrics: tilePlan.baseMetrics,
      derived: tilePlan.derived,
      effectiveGrain: tilePlan.effectiveGrain,
      weekStart: report.defaults.weekStart,
      ...(definition.query.topN ? { topN: definition.query.topN } : {}),
      ...(definition.query.having.length > 0 ? { having: definition.query.having } : {}),
      ...(definition.query.orderBy.length > 0 ? { orderBy: definition.query.orderBy } : {}),
      ...(definition.query.limit ? { limit: definition.query.limit } : {}),
    };

    const merged = mergeResults(primary, mergeOptions);
    notices.push(...merged.notices);

    let comparison: TileResult['comparison'];
    if (compareRange && definition.query.comparison !== 'none') {
      const compared = await fetchFor(compareRange);
      if (compared.length > 0) {
        const mergedComparison = mergeResults(compared, mergeOptions);
        comparison = {
          range: compareRange,
          rows: mergedComparison.rows,
          totals: mergedComparison.totals,
        };
      }
    }

    const partial =
      primary.length < tilePlan.subQueries.length ||
      primary.some((entry) => entry.resultSet.status !== 'ok');

    const result: TileResult = {
      tileId: tilePlan.tileId,
      status: partial ? 'partial' : 'ok',
      columns: merged.columns,
      rows: merged.rows,
      totals: merged.totals,
      ...(comparison ? { comparison } : {}),
      effectiveGrain: tilePlan.effectiveGrain,
      unavailableMetrics: tilePlan.unavailableMetrics,
      provenance: tilePlan.assignments.map((a) => ({
        metric: a.metric,
        sourceId: a.sourceId,
        rule: a.rule,
      })),
      contributions: merged.contributions,
      dataAsOf: merged.dataAsOf,
      notices,
      cacheHit: false,
    };

    // TTL comes from the sealed/hot split: a fully sealed historical range can be held for
    // a week, while anything touching a restatable day gets minutes.
    const restatementWindow = Math.max(
      0,
      ...primary.map(
        (entry) =>
          sources.find((s) => s.sourceId === entry.sourceId)?.freshness.restatementWindowDays ?? 0
      )
    );
    const ttl = decideTtl(
      range,
      deps.today,
      restatementWindow,
      deps.ttlTodaySeconds,
      deps.ttlSealedSeconds
    );
    // Never cache a partial tile for long — the gap is probably transient.
    deps.cache.set(key, result, partial ? Math.min(60, ttl.ttlSeconds) : ttl.ttlSeconds, 60);

    return result;
  };

  const tiles = await mapLimit(plan.tiles, deps.maxConcurrency, runTile);

  const asOf = tiles
    .map((t) => t.dataAsOf)
    .filter((v): v is string => Boolean(v))
    .sort();

  const anyUnavailable = tiles.some((t) => t.status === 'unavailable');
  const anyPartial = tiles.some((t) => t.status === 'partial');
  const allUnavailable = tiles.length > 0 && tiles.every((t) => t.status === 'unavailable');

  const status: RunReportResult['status'] =
    allUnavailable || (report.failurePolicy === 'strict' && (anyUnavailable || anyPartial))
      ? 'failed'
      : anyUnavailable || anyPartial
        ? 'partial'
        : 'ok';

  return {
    reportId: report.id,
    reportVersion: report.version,
    runId,
    status,
    range,
    compareRange,
    grain,
    tiles,
    notices: plan.notices,
    dataAsOf: asOf.length > 0 ? asOf[0] : null,
    registrySources: sources.map((s) => s.sourceId),
  };
};
