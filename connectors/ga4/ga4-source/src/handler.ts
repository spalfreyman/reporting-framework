import { readConfiguration } from './env.js';
import { buildResultSet, DspFailure, type DspHandlerContext } from './shared/dsp/server.js';
import type { ResultSet } from './shared/schema/query.js';
import type { CustomObjectPort } from './shared/ct/ports.js';
import { splitSealedHot } from './shared/util/date-range.js';
import { buildDemoRows } from './demo-data.js';
import { runGa4Report } from './live.js';
import { cacheKeyFor, readCache, writeCache } from './cache.js';
import type { TokenBucket } from './quota.js';

/**
 * The GA4 query handler.
 *
 * Cache first — a hit spends no GA4 token. On a miss, the token bucket decides whether a live
 * call is affordable; if not, stale cache is served (flagged) rather than blowing the shared
 * per-property quota. A sealed historical range caches for hours, a range touching today for
 * minutes.
 */
export interface HandlerDeps {
  port: CustomObjectPort;
  bucket: TokenBucket;
  now?: () => Date;
}

export const createQueryHandler =
  (deps: HandlerDeps) =>
  async ({ query, descriptor }: DspHandlerContext): Promise<ResultSet> => {
    const config = readConfiguration();
    const now = deps.now ?? (() => new Date());

    if (!query.timeRange) {
      throw new DspFailure('UNSUPPORTED_GRAIN', 'GA4 queries need a time range.');
    }

    const today = now().toISOString().slice(0, 10);
    const { hot } = splitSealedHot(query.timeRange, today, descriptor.freshness.restatementWindowDays);
    const ttl = hot ? config.CACHE_TTL_TODAY_SECONDS : config.CACHE_TTL_SEALED_SECONDS;

    // ── Demo mode: deterministic fixtures, no cache or quota needed ─────────────
    if (config.MODE === 'demo') {
      const { columns, rows } = buildDemoRows(query);
      return buildResultSet({
        descriptor,
        columns,
        rows,
        execution: 'live',
        dataAsOf: now().toISOString(),
        grainServed: query.grain,
        degradedReason: 'demo-fixture',
        detail: 'Demo mode: GA4 figures are generated, not real.',
        ttlSeconds: ttl,
      });
    }

    // ── Live mode: cache → quota → GA4 ──────────────────────────────────────────
    const key = cacheKeyFor(descriptor.sourceId, {
      metrics: query.metrics,
      dimensions: query.dimensions,
      grain: query.grain,
      timeRange: query.timeRange,
      filters: query.filters,
    });

    const cached = await readCache(deps.port, key, now());
    if (cached && !cached.stale) {
      return { ...cached.resultSet, provenance: { ...cached.resultSet.provenance, cacheHit: true } };
    }

    if (!deps.bucket.tryTake(1)) {
      // Out of tokens. Serve stale cache if we have it; otherwise fail as quota-exhausted so
      // the gateway degrades this tile rather than the whole report.
      if (cached) {
        return buildResultSet({
          descriptor,
          columns: cached.resultSet.columns,
          rows: cached.resultSet.rows,
          execution: 'live',
          dataAsOf: cached.resultSet.provenance.dataAsOf,
          grainServed: query.grain,
          degradedReason: 'quota-exhausted',
          detail: 'GA4 quota exhausted; showing the last cached figures.',
          cacheHit: true,
          ttlSeconds: ttl,
        });
      }
      throw new DspFailure('QUOTA_EXCEEDED', 'GA4 per-property token budget is exhausted', {
        retryable: true,
        retryAfterSeconds: 3600,
      });
    }

    try {
      const { columns, rows, sampled } = await runGa4Report(query);
      // Sampling is carried by each metric column's `exactness: 'sampled'` (set in live.ts),
      // NOT by a degradedReason — a sampled response is still a real, usable answer, and the
      // UI marks it estimated from the column metadata. `partial` flags only that it is not a
      // full census, which is true of any sampled GA4 result.
      const resultSet = buildResultSet({
        descriptor,
        columns,
        rows,
        execution: 'live',
        dataAsOf: now().toISOString(),
        grainServed: query.grain,
        partial: sampled,
        upstreamRequests: 1,
        ttlSeconds: ttl,
      });
      await writeCache(deps.port, key, resultSet, ttl, now());
      return resultSet;
    } catch (error) {
      if (error instanceof DspFailure) throw error;
      // A transient GA4 error: serve stale cache if present, else surface as unavailable.
      if (cached) {
        return { ...cached.resultSet, provenance: { ...cached.resultSet.provenance, cacheHit: true } };
      }
      throw new DspFailure('UPSTREAM_UNAVAILABLE', 'GA4 Data API request failed', { retryable: true });
    }
  };
