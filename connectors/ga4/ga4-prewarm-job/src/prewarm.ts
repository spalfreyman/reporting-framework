import type { CustomObjectPort } from './shared/ct/ports.js';
import { CO } from './shared/schema/descriptor.js';
import { addDays } from './shared/util/date-range.js';
import type { SourceQuery } from './shared/schema/query.js';
import type { DataSourceDescriptor } from './shared/schema/descriptor.js';

/**
 * Pure planning of what to pre-warm.
 *
 * The point of pre-warming is to move GA4's quota cost off the interactive path: fetch the
 * windows dashboards actually open (last 7/28/90 days, at day grain, split by the common
 * dimensions) overnight so the cache is hot by morning. It reuses the SAME cache-key inputs
 * the handler uses, so a warmed entry is a genuine hit — not a near-miss.
 */

export interface PrewarmTarget {
  metrics: string[];
  dimensions: string[];
  grain: 'day';
  timeRange: { from: string; to: string };
}

const WINDOWS = [7, 28, 90];
const COMMON = [
  { metrics: ['sessions.count', 'users.active'], dimensions: [] as string[] },
  { metrics: ['sessions.count', 'checkoutstart.count', 'addtocart.count'], dimensions: [] },
  { metrics: ['sessions.count'], dimensions: ['trafficChannel'] },
  { metrics: ['sessions.count'], dimensions: ['device'] },
  { metrics: ['sessions.count'], dimensions: ['country'] },
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
  limit: 100000,
  budgetMs: 60000,
});
