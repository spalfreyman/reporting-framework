import { demoItemDay } from './shared/demo/generator.js';
import { eachDay, bucketDay } from './shared/util/date-range.js';
import { getMetric } from './shared/semantic/metrics.js';
import type { ColumnMeta, SourceQuery } from './shared/schema/query.js';
import type { CompiledQuery } from './compile-query.js';

/**
 * Demo-mode warehouse data, from the shared generator so it lines up with the other sources
 * (same seed). demoItemDay carries unit cost and per-SKU revenue, which is exactly the
 * scale-tier data commercetools does not hold — so a margin report lights up.
 *
 * The demo path is driven by the SAME CompiledQuery the live path uses, so a template that
 * cannot be compiled is rejected identically in both modes. It just satisfies the compiled
 * intent from fixtures instead of SQL.
 */

// A deterministic marketing-spend series, so ROAS/CAC have a denominator in demo mode.
const demoSpendDay = (day: string): Array<{ channel: string; currency: string; spend: number }> => {
  const channels = ['Paid Search', 'Paid Social', 'Email'];
  return channels.map((channel, i) => {
    // Cheap deterministic hash of day+channel → a stable spend figure in minor units.
    let h = 2166136261;
    for (const ch of `${day}|${channel}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const spend = 20000 + (h % 80000) + i * 5000;
    return { channel, currency: 'EUR', spend };
  });
};

export const buildDemoRows = (
  query: SourceQuery,
  compiled: CompiledQuery
): { columns: ColumnMeta[]; rows: Array<Array<string | number | null>> } => {
  const days = query.timeRange ? eachDay(query.timeRange) : [];
  const grain = query.grain ?? 'day';
  const groupDims = compiled.groupDimensions;
  const includeDate = query.dimensions.includes('date') || query.grain !== null;
  const acc = new Map<string, { day: string; key: Record<string, string>; m: Record<string, number> }>();

  const add = (day: string, key: Record<string, string>, measures: Record<string, number>) => {
    const bucket = bucketDay(day, grain, 'monday');
    const mapKey = [includeDate ? bucket : '', ...groupDims.map((d) => key[d] ?? '')].join('|');
    const target = acc.get(mapKey) ?? { day: bucket, key, m: {} };
    for (const metricId of query.metrics) {
      if (measures[metricId] !== undefined) target.m[metricId] = (target.m[metricId] ?? 0) + measures[metricId];
    }
    acc.set(mapKey, target);
  };

  const wantsSpend = query.metrics.includes('marketing.spend');

  for (const day of days) {
    if (wantsSpend) {
      for (const s of demoSpendDay(day)) {
        add(day, { channel: s.channel, currency: s.currency }, { 'marketing.spend': s.spend });
      }
    } else {
      for (const item of demoItemDay(day, 60)) {
        add(
          day,
          { currency: item.currency, store: item.store, product: item.product, category: item.category },
          {
            'cost.goods@orderdate': item.unitCost * item.units,
            'revenue.net@orderdate': item.revenueNet,
            'units.sold@orderdate': item.units,
          }
        );
      }
    }
  }

  const columns: ColumnMeta[] = [
    ...(includeDate ? [{ id: 'date', role: 'time' as const, valueType: 'time' as const, exactness: 'exact' as const, nullMeaning: 'zero' as const }] : []),
    ...groupDims.map((id) => ({ id, role: 'dimension' as const, valueType: 'string' as const, exactness: 'exact' as const, nullMeaning: 'unknown' as const })),
    ...query.metrics.map((id) => ({
      id,
      role: 'metric' as const,
      valueType: getMetric(id)?.valueType ?? ('count' as const),
      ...(getMetric(id)?.valueType === 'money' ? { currencyCode: 'EUR', fractionDigits: 2 } : {}),
      exactness: 'exact' as const,
      nullMeaning: 'zero' as const,
    })),
  ];

  const rows = [...acc.values()]
    .slice(0, query.limit)
    .map((entry) => [
      ...(includeDate ? [entry.day] : []),
      ...groupDims.map((d) => entry.key[d] ?? null),
      ...query.metrics.map((id) => entry.m[id] ?? 0),
    ]);

  return { columns, rows };
};
