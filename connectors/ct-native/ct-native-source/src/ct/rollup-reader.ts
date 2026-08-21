import type { CustomObjectPort } from '../shared/ct/ports.js';
import type { ColumnMeta, SourceQuery } from '../shared/schema/query.js';
import { cubeContainer, dayPartitionKey, type DayPartition } from '../shared/rollup/keying.js';
import { eachDay } from '../shared/util/date-range.js';
import { getMetric } from '../shared/semantic/metrics.js';

/**
 * Reads order-grain metrics from the day-partitioned rollup fact store.
 *
 * This is a POINT-READ path: "last 28 days" is 28 gets by key, not a predicate scan. That
 * is the entire reason the rollup writes one object per (date, cube, shard) holding a rows
 * array rather than one object per fact row — it avoids depending on value-field index
 * performance, and it collapses object count by three orders of magnitude.
 */

/** Which cube serves which metric. A metric absent here is not materialized. */
const CUBE_BY_METRIC: Record<string, string> = {
  'orders.count@orderdate': 'orders-daily',
  'revenue.gross@orderdate': 'orders-daily',
  'revenue.net@orderdate': 'orders-daily',
  'revenue.net@cashdate': 'orders-daily',
  'discount.value@orderdate': 'orders-daily',
  'shipping.revenue@orderdate': 'orders-daily',
  'tax.collected@orderdate': 'orders-daily',
  'lines.count@orderdate': 'orders-daily',
  'refunds.value@cashdate': 'orders-daily',
  'customers.new@orderdate': 'orders-daily',
  'customers.active@orderdate': 'orders-daily',
  'orders.promoted@orderdate': 'orders-daily',
  'units.sold@orderdate': 'order-lines-daily',
  'returns.units@orderdate': 'returns-daily',
  'discount.redemptions': 'promotions-daily',
  'customers.cohortSize': 'customers-daily',
  'customers.retained': 'customers-daily',
  'shipments.count': 'fulfilment-daily',
  'shipments.onTime': 'fulfilment-daily',
};

/** Measure name inside a fact cell, which is shorter than the metric id. */
const MEASURE_BY_METRIC: Record<string, string> = {
  'orders.count@orderdate': 'orders',
  'revenue.gross@orderdate': 'revenueGross',
  'revenue.net@orderdate': 'revenueNet',
  'revenue.net@cashdate': 'revenueNetCash',
  'discount.value@orderdate': 'discount',
  'shipping.revenue@orderdate': 'shipping',
  'tax.collected@orderdate': 'tax',
  'lines.count@orderdate': 'lines',
  'refunds.value@cashdate': 'refunds',
  'customers.new@orderdate': 'customersNew',
  'customers.active@orderdate': 'customersActive',
  'orders.promoted@orderdate': 'ordersPromoted',
  'units.sold@orderdate': 'units',
  'returns.units@orderdate': 'returnsUnits',
  'discount.redemptions': 'redemptions',
  'customers.cohortSize': 'cohortSize',
  'customers.retained': 'retained',
  'shipments.count': 'shipments',
  'shipments.onTime': 'shipmentsOnTime',
};

export const cubesFor = (metrics: string[]): string[] => [
  ...new Set(metrics.map((m) => CUBE_BY_METRIC[m]).filter(Boolean)),
];

export interface RollupReadResult {
  columns: ColumnMeta[];
  rows: Array<Array<string | number | null>>;
  /** Newest watermark across the partitions actually read. */
  dataAsOf: string | null;
  /** Days in the requested range with no partition at all — a genuine coverage gap. */
  missingDays: string[];
  partitionsRead: number;
}

const asFilterPredicate = (query: SourceQuery) => {
  const include: Array<(cell: Record<string, string>) => boolean> = [];

  for (const filter of query.filters) {
    if ('values' in filter) {
      const values = filter.values.map(String);
      include.push((cell) =>
        filter.op === 'in'
          ? values.includes(cell[filter.dimension] ?? '')
          : !values.includes(cell[filter.dimension] ?? '')
      );
    } else if ('value' in filter) {
      const value = String(filter.value);
      include.push((cell) =>
        filter.op === 'eq' ? cell[filter.dimension] === value : cell[filter.dimension] !== value
      );
    }
  }

  // Row-level scope is an intersection, applied identically to a filter but NOT overridable
  // by one: a user filter can narrow within scope, never widen beyond it.
  if (!query.scope.unrestricted) {
    const scoped: Array<[string, string[]]> = [];
    if (query.scope.stores) scoped.push(['store', query.scope.stores]);
    if (query.scope.channels) scoped.push(['distributionChannel', query.scope.channels]);
    if (query.scope.countries) scoped.push(['country', query.scope.countries]);
    for (const [dimension, allowed] of scoped) {
      include.push((cell) => allowed.includes(cell[dimension] ?? ''));
    }
  }

  return (cell: Record<string, string>) => include.every((test) => test(cell));
};

export const readRollup = async (
  port: CustomObjectPort,
  query: SourceQuery
): Promise<RollupReadResult> => {
  const days = query.timeRange ? eachDay(query.timeRange) : [];
  const cubes = cubesFor(query.metrics);
  const matches = asFilterPredicate(query);

  const groupBy = query.dimensions.filter((d) => d !== 'date');
  const includeDate = query.dimensions.includes('date') || query.grain !== null;

  // Accumulate into a map keyed by (day, ...dimension values).
  const accumulator = new Map<string, { key: Record<string, string>; day: string; m: Record<string, number> }>();
  const missingDays: string[] = [];
  const watermarks: string[] = [];
  let partitionsRead = 0;

  for (const day of days) {
    let foundAny = false;

    for (const cube of cubes) {
      const container = cubeContainer(cube);
      // Shards are read until one is absent; sharding is deterministic and contiguous.
      for (let shard = 0; ; shard += 1) {
        const entry = await port.get<DayPartition>(container, dayPartitionKey(day, shard));
        if (!entry) break;
        foundAny = true;
        partitionsRead += 1;
        watermarks.push(entry.value.meta.watermark);

        for (const cell of entry.value.rows) {
          if (!matches(cell.k)) continue;

          const keyParts = groupBy.map((d) => cell.k[d] ?? '');
          const mapKey = [includeDate ? day : '', ...keyParts].join('|');
          const existing = accumulator.get(mapKey);
          const target =
            existing ??
            {
              key: Object.fromEntries(groupBy.map((d) => [d, cell.k[d] ?? ''])),
              day,
              m: {},
            };

          for (const metricId of query.metrics) {
            const measure = MEASURE_BY_METRIC[metricId];
            if (!measure) continue;
            const value = cell.m[measure];
            if (value === null || value === undefined) continue;

            const def = getMetric(metricId);
            // Aggregating cells within a day respects the metric's own rule. A distinct
            // count is NOT summable, so collapsing cells would inflate it — leave it null
            // and let the caller see that it cannot be served at this grouping.
            if (def?.kind === 'base' && !def.additive.overDimensions) {
              target.m[metricId] = existing ? Number.NaN : value;
              continue;
            }
            target.m[metricId] = (target.m[metricId] ?? 0) + value;
          }

          if (!existing) accumulator.set(mapKey, target);
        }
      }
    }

    if (!foundAny) missingDays.push(day);
  }

  const columns: ColumnMeta[] = [
    ...(includeDate
      ? [
          {
            id: 'date',
            role: 'time' as const,
            valueType: 'time' as const,
            exactness: 'exact' as const,
            nullMeaning: 'unknown' as const,
          },
        ]
      : []),
    ...groupBy.map((id) => ({
      id,
      role: 'dimension' as const,
      valueType: 'string' as const,
      exactness: 'exact' as const,
      nullMeaning: 'unknown' as const,
    })),
    ...query.metrics.map((id) => {
      const def = getMetric(id);
      return {
        id,
        role: 'metric' as const,
        valueType: def?.valueType ?? ('count' as const),
        exactness: 'exact' as const,
        nullMeaning: (def?.nullSemantics === 'null' ? 'unknown' : 'zero') as 'unknown' | 'zero',
      };
    }),
  ];

  const rows = [...accumulator.values()].map((entry) => [
    ...(includeDate ? [entry.day] : []),
    ...groupBy.map((d) => entry.key[d] ?? null),
    ...query.metrics.map((id) => {
      const value = entry.m[id];
      if (value === undefined) return null;
      // NaN is the marker set above for a non-additive metric that got collapsed.
      return Number.isNaN(value) ? null : value;
    }),
  ]);

  return {
    columns,
    rows,
    dataAsOf: watermarks.length > 0 ? watermarks.sort()[watermarks.length - 1] : null,
    missingDays,
    partitionsRead,
  };
};
