import { demoWebDay } from './shared/demo/generator.js';
import { eachDay } from './shared/util/date-range.js';
import { getMetric } from './shared/semantic/metrics.js';
import { bucketDay } from './shared/util/date-range.js';
import type { ColumnMeta, SourceQuery } from './shared/schema/query.js';

/**
 * Demo-mode GA4 data, from the shared deterministic generator.
 *
 * Uses the SAME seed as the commercetools demo data, so a cross-source conversion rate
 * (ct-native orders ÷ GA4 sessions) lands in a believable band instead of wandering — which
 * is the whole point of being able to demo the framework with no Google credentials.
 */

const MEASURE: Record<string, keyof ReturnType<typeof demoWebDay>[number]> = {
  'sessions.count': 'sessions',
  'users.active': 'activeUsers',
  'pageviews.count': 'pageviews',
  'productviews.count': 'productViews',
  'addtocart.count': 'addToCarts',
  'checkoutstart.count': 'checkoutStarts',
  'searches.count': 'searches',
  'searches.zeroResult': 'zeroResultSearches',
};

export const buildDemoRows = (
  query: SourceQuery
): { columns: ColumnMeta[]; rows: Array<Array<string | number | null>> } => {
  const days = query.timeRange ? eachDay(query.timeRange) : [];
  const grain = query.grain ?? 'day';
  const groupDims = query.dimensions.filter((d) => d !== 'date');
  const includeDate = query.dimensions.includes('date') || query.grain !== null;

  // Accumulate additive web metrics per (bucketed day, dimension values).
  const acc = new Map<string, { day: string; key: Record<string, string>; m: Record<string, number> }>();

  const matchesFilters = (row: Record<string, unknown>): boolean =>
    query.filters.every((f) => {
      const value = String(row[f.dimension] ?? '');
      if ('values' in f) {
        return f.op === 'in' ? f.values.map(String).includes(value) : !f.values.map(String).includes(value);
      }
      if ('value' in f) return f.op === 'eq' ? value === String(f.value) : value !== String(f.value);
      return true;
    });

  for (const day of days) {
    const bucket = bucketDay(day, grain, 'monday');
    for (const web of demoWebDay(day)) {
      if (!matchesFilters(web as unknown as Record<string, unknown>)) continue;
      const key = Object.fromEntries(groupDims.map((d) => [d, String((web as unknown as Record<string, unknown>)[d] ?? '')]));
      const mapKey = [includeDate ? bucket : '', ...groupDims.map((d) => key[d])].join('|');
      const target = acc.get(mapKey) ?? { day: bucket, key, m: {} };
      for (const metricId of query.metrics) {
        const field = MEASURE[metricId];
        if (!field) continue;
        target.m[metricId] = (target.m[metricId] ?? 0) + (web[field] as number);
      }
      acc.set(mapKey, target);
    }
  }

  const columns: ColumnMeta[] = [
    ...(includeDate
      ? [{ id: 'date', role: 'time' as const, valueType: 'time' as const, exactness: 'sampled' as const, nullMeaning: 'zero' as const }]
      : []),
    ...groupDims.map((id) => ({
      id,
      role: 'dimension' as const,
      valueType: 'string' as const,
      exactness: 'sampled' as const,
      nullMeaning: 'unknown' as const,
    })),
    ...query.metrics.map((id) => ({
      id,
      role: 'metric' as const,
      valueType: getMetric(id)?.valueType ?? ('count' as const),
      // GA4 figures are modelled; never let them read as exact next to commercetools.
      exactness: 'sampled' as const,
      nullMeaning: 'zero' as const,
    })),
  ];

  const rows = [...acc.values()].map((entry) => [
    ...(includeDate ? [entry.day] : []),
    ...groupDims.map((d) => entry.key[d] ?? null),
    ...query.metrics.map((id) => entry.m[id] ?? 0),
  ]);

  return { columns, rows };
};
