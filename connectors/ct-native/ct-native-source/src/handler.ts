import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { DspFailure, buildResultSet, type DspHandlerContext } from './shared/dsp/server.js';
import type { ColumnMeta, ResultSet } from './shared/schema/query.js';
import type { CustomObjectPort } from './shared/ct/ports.js';
import { getMetric } from './shared/semantic/metrics.js';
import { eachDay } from './shared/util/date-range.js';
import { CO } from './shared/schema/descriptor.js';
import {
  demoItemDay,
  demoOrderDay,
  type DemoItemDay,
  type DemoOrderDay,
} from './shared/demo/generator.js';
import { readRollup } from './ct/rollup-reader.js';
import { readLiveFacets } from './ct/live-facets.js';
import { readConfiguration } from './env.js';

/**
 * The query handler.
 *
 * A single query must not straddle execution modes: live catalogue facets are a
 * point-in-time snapshot with no time grain, while order metrics are time-bucketed reads
 * from the rollup. Mixing them in one request has no coherent answer, so it is refused —
 * the gateway plans them as separate tiles anyway.
 */

const LIVE_METRICS = new Set([
  'products.count',
  'variants.count',
  'price.min',
  'price.max',
  'price.mean',
  'inventory.available',
]);

export interface HandlerDeps {
  apiRoot: () => ByProjectKeyRequestBuilder;
  port: () => CustomObjectPort;
  now?: () => Date;
}

export const createQueryHandler =
  (deps: HandlerDeps) =>
  async ({ query, descriptor }: DspHandlerContext): Promise<ResultSet> => {
    const config = readConfiguration();
    const now = deps.now ?? (() => new Date());

    const liveRequested = query.metrics.filter((m) => LIVE_METRICS.has(m));
    const materializedRequested = query.metrics.filter((m) => !LIVE_METRICS.has(m));

    if (liveRequested.length > 0 && materializedRequested.length > 0) {
      throw new DspFailure(
        'UNSUPPORTED_METRIC',
        `Cannot mix live catalogue metrics (${liveRequested.join(', ')}) with time-bucketed ` +
          `order metrics (${materializedRequested.join(', ')}) in one query: a point-in-time ` +
          `snapshot and a time series have no common answer.`
      );
    }

    // ── Live catalogue path ───────────────────────────────────────────────────
    if (liveRequested.length > 0) {
      if (config.MODE === 'demo') {
        return demoCatalogue(query, descriptor, now());
      }
      const facets = await readLiveFacets(deps.apiRoot(), query, config.PRICE_BANDS);
      return buildResultSet({
        descriptor,
        columns: facets.columns,
        rows: facets.rows,
        execution: 'live',
        // Live means live: the watermark is the moment we asked.
        dataAsOf: now().toISOString(),
        grainServed: null,
        partial: facets.partial,
        ...(facets.partial ? { degradedReason: 'facet-term-cap' as const } : {}),
        ...(facets.detail ? { detail: facets.detail } : {}),
        upstreamRequests: facets.upstreamRequests,
        ttlSeconds: config.CACHE_TTL_SECONDS,
      });
    }

    // ── Materialized order path ───────────────────────────────────────────────
    if (!query.timeRange) {
      throw new DspFailure(
        'UNSUPPORTED_GRAIN',
        'Order metrics need a time range: they are read from day-partitioned rollups.'
      );
    }

    if (config.MODE === 'demo') {
      return demoOrders(query, descriptor, now());
    }

    // The watermark is the newest day the rollup job has processed. A day with no partition
    // on or before it is genuine zero trade; only a day AFTER it is truly not-yet-rolled-up.
    const watermarkEntry = await deps
      .port()
      .get<{ throughDate?: string }>(CO.config, CO.keys.rollupWatermark);
    const watermark = watermarkEntry?.value.throughDate ?? null;

    const rollup = await readRollup(deps.port(), query);

    const notYetRolledUp = watermark
      ? rollup.missingDays.filter((day) => day > watermark)
      : rollup.missingDays;
    const requestedDays = eachDay(query.timeRange).length;
    const partial = notYetRolledUp.length > 0;

    return buildResultSet({
      descriptor,
      columns: rollup.columns,
      rows: rollup.rows,
      execution: 'materialized',
      dataAsOf: rollup.dataAsOf ?? watermarkEntry?.value.throughDate ?? now().toISOString(),
      // The store grain is day; higher grains are the gateway's roll-up, so declare the truth.
      grainServed: 'day',
      partial,
      ...(partial
        ? {
            degradedReason: 'range-clamped' as const,
            detail:
              `${notYetRolledUp.length} of ${requestedDays} day(s) are not yet materialized ` +
              `(newest rolled up: ${watermark ?? 'none'}). Run the rollup job to catch up.`,
          }
        : {}),
    });
  };

// ── Demo mode ───────────────────────────────────────────────────────────────────
//
// Serves the same shapes as the real paths from the shared deterministic generator, so the
// whole framework is demonstrable on a project with no order history — and so the figures
// line up with the GA4 and ERP mocks, which generate from the same seed.

const columnsFor = (
  query: DspHandlerContext['query'],
  includeDate: boolean,
  currency?: string
): ColumnMeta[] => [
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
  ...query.dimensions
    .filter((d) => d !== 'date')
    .map((id) => ({
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
      ...(def?.valueType === 'money' && currency
        ? { currencyCode: currency, fractionDigits: 2 }
        : {}),
      exactness: 'exact' as const,
      nullMeaning: (def?.nullSemantics === 'null' ? 'unknown' : 'zero') as 'unknown' | 'zero',
    };
  }),
];

const MEASURE_BY_METRIC: Record<string, string> = {
  'orders.count@orderdate': 'orders',
  'revenue.gross@orderdate': 'revenueGross',
  'revenue.net@orderdate': 'revenueNet',
  'revenue.net@cashdate': 'revenueNet',
  'discount.value@orderdate': 'discount',
  'shipping.revenue@orderdate': 'shipping',
  'tax.collected@orderdate': 'tax',
  'refunds.value@cashdate': 'refunds',
  'lines.count@orderdate': 'lines',
  'customers.new@orderdate': 'customersNew',
  'customers.active@orderdate': 'customersActive',
  'orders.promoted@orderdate': 'ordersPromoted',
};

const demoOrders = (
  query: DspHandlerContext['query'],
  descriptor: DspHandlerContext['descriptor'],
  now: Date
): ResultSet => {
  const days = query.timeRange ? eachDay(query.timeRange) : [];
  const groupBy = query.dimensions.filter((d) => d !== 'date');
  const wantsItemGrain = groupBy.includes('product') || groupBy.includes('category');

  const accumulator = new Map<string, { day: string; key: Record<string, string>; m: Record<string, number> }>();

  for (const day of days) {
    const rows = wantsItemGrain
      ? demoItemDay(day, 40).map((row: DemoItemDay) => ({
          date: row.date,
          store: row.store,
          currency: row.currency,
          product: row.product,
          category: row.category,
          channel: 'web',
          country: row.store.startsWith('uk-') ? 'GB' : row.store.startsWith('fr-') ? 'FR' : 'DE',
          orderState: 'Confirmed',
          'units.sold@orderdate': row.units,
          'revenue.net@orderdate': row.revenueNet,
          'returns.units@orderdate': row.returnsUnits,
        }))
      : demoOrderDay(day).map((row: DemoOrderDay) => ({
          ...row,
          distributionChannel: row.channel,
        }));

    for (const row of rows as Array<Record<string, unknown>>) {
      // Honour scope in demo mode too, so a scoped user's demo matches their real view.
      if (!query.scope.unrestricted) {
        if (query.scope.stores && !query.scope.stores.includes(String(row.store))) continue;
        if (
          query.scope.channels &&
          !query.scope.channels.includes(String(row.distributionChannel ?? row.channel))
        ) {
          continue;
        }
        if (query.scope.countries && !query.scope.countries.includes(String(row.country))) continue;
      }

      const key = Object.fromEntries(groupBy.map((d) => [d, String(row[d] ?? '')]));
      const mapKey = [day, ...groupBy.map((d) => key[d])].join('|');
      const target = accumulator.get(mapKey) ?? { day, key, m: {} };

      for (const metricId of query.metrics) {
        const direct = row[metricId];
        const measure = MEASURE_BY_METRIC[metricId];
        const value =
          typeof direct === 'number' ? direct : measure ? Number(row[measure] ?? 0) : 0;
        target.m[metricId] = (target.m[metricId] ?? 0) + value;
      }
      accumulator.set(mapKey, target);
    }
  }

  const currency = query.dimensions.includes('currency') ? undefined : 'EUR';
  const rows = [...accumulator.values()].map((entry) => [
    entry.day,
    ...groupBy.map((d) => entry.key[d] ?? null),
    ...query.metrics.map((id) => entry.m[id] ?? null),
  ]);

  return buildResultSet({
    descriptor,
    columns: columnsFor(query, true, currency),
    rows,
    execution: 'materialized',
    dataAsOf: now.toISOString(),
    grainServed: query.grain,
    degradedReason: 'demo-fixture',
    detail: 'Demo mode: figures are generated, not real.',
  });
};

const demoCatalogue = (
  query: DspHandlerContext['query'],
  descriptor: DspHandlerContext['descriptor'],
  now: Date
): ResultSet => {
  const breakdown = query.dimensions.find((d) => d !== 'currency');
  const categories = ['outerwear', 'footwear', 'accessories', 'knitwear', 'denim', 'bags'];

  const rows: Array<Array<string | number | null>> = breakdown
    ? categories.map((category, index) => [
        category,
        ...query.metrics.map((id) => demoCatalogueValue(id, 60 - index * 4)),
      ])
    : [query.metrics.map((id) => demoCatalogueValue(id, 360))];

  return buildResultSet({
    descriptor,
    columns: columnsFor(query, false, 'EUR'),
    rows,
    execution: 'live',
    dataAsOf: now.toISOString(),
    grainServed: null,
    degradedReason: 'demo-fixture',
    detail: 'Demo mode: figures are generated, not real.',
  });
};

const demoCatalogueValue = (metricId: string, count: number): number => {
  switch (metricId) {
    case 'products.count':
      return count;
    case 'variants.count':
      return count * 3;
    case 'price.min':
      return 1999;
    case 'price.mean':
      return 7450;
    case 'price.max':
      return 24999;
    case 'inventory.available':
      return count * 18;
    default:
      return count;
  }
};
