import type { CustomObjectPort } from './shared/ct/ports.js';
import { CO } from './shared/schema/descriptor.js';
import type { DataSourceDescriptor } from './shared/schema/descriptor.js';
import { addDays } from './shared/util/date-range.js';
import type { SourceQuery } from './shared/schema/query.js';

/**
 * Pure planning of what to pre-warm / extract.
 *
 * For a cache-backed source this fetches the windows dashboards actually open (last 7/28/90
 * days, at day grain, split by the common dimensions) so the cache is hot by morning. For an
 * extract-style connector, replace this with the pull-and-store logic; the HTTP-server shape
 * in app.ts stays the same.
 */

export interface PrewarmTarget {
  metrics: string[];
  dimensions: string[];
  grain: 'day';
  timeRange: { from: string; to: string };
}

const WINDOWS = [7, 28, 90];
/** Common metric/dimension combinations to warm — mirror what the source actually serves. */
const COMMON = [
  { metrics: ['sample.visits', 'sample.signups'], dimensions: [] as string[] },
  { metrics: ['sample.visits'], dimensions: ['channel'] },
  { metrics: ['sample.visits'], dimensions: ['region'] },
];

export const planPrewarm = (today: string, lookbackDays: number): PrewarmTarget[] => {
  const targets: PrewarmTarget[] = [];
  for (const combo of COMMON) {
    for (const window of WINDOWS) {
      if (window > lookbackDays) continue;
      targets.push({
        metrics: combo.metrics,
        dimensions: combo.dimensions,
        grain: 'day',
        timeRange: { from: addDays(today, -window), to: today },
      });
    }
  }
  return targets;
};

/** Reads the source's URL from its registered descriptor when not configured explicitly. */
export const resolveSourceUrl = async (
  port: CustomObjectPort,
  sourceId: string,
  override?: string
): Promise<string | null> => {
  if (override) return override.replace(/\/$/, '');
  const entry = await port.get<DataSourceDescriptor>(CO.datasources, sourceId);
  return entry?.value.endpointUrl?.replace(/\/$/, '') ?? null;
};

export const toSourceQuery = (
  projectKey: string,
  _sourceId: string,
  target: PrewarmTarget,
  requestId: string
): SourceQuery => ({
  protocolVersion: 1,
  requestId,
  projectKey,
  metrics: target.metrics,
  dimensions: target.dimensions,
  grain: target.grain,
  timeRange: target.timeRange,
  timezone: 'UTC',
  filters: [],
  scope: { unrestricted: true },
  orderBy: [],
  // The DSP query schema caps `limit` at 50000; day-grain aggregates return far fewer.
  limit: 50000,
  budgetMs: 60000,
});
