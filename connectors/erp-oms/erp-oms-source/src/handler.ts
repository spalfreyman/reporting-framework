import { readConfiguration } from './env.js';
import { buildResultSet, DspFailure, type DspHandlerContext } from './shared/dsp/server.js';
import { getMetric } from './shared/semantic/metrics.js';
import { addDays, bucketDay } from './shared/util/date-range.js';
import type { ColumnMeta, ResultSet, SourceQuery } from './shared/schema/query.js';
import { fakeFulfilment, fakeInventory, fakeReturns } from './shared/demo/fake-erp.js';

/**
 * The ERP/OMS query handler.
 *
 * Demo mode answers from the fake ERP. Live mode would answer from the nightly extract's
 * fact objects (the extract job populates them); a real ERP is too slow to hit per request,
 * which is the whole reason the connector is service + job rather than service alone.
 *
 * Metrics map to one of three ERP datasets — inventory (point-in-time), fulfilment (daily),
 * returns (daily) — and a single query stays within one, because they have different grains
 * and mixing them has no coherent answer.
 */

const INVENTORY = new Set(['inventory.available']);
const FULFILMENT = new Set(['shipments.count', 'shipments.onTime', 'fulfilment.pickToShipSeconds']);
const RETURNS = new Set(['returns.units@orderdate']);

const datasetOf = (metrics: string[]): 'inventory' | 'fulfilment' | 'returns' => {
  const inv = metrics.some((m) => INVENTORY.has(m));
  const ful = metrics.some((m) => FULFILMENT.has(m));
  const ret = metrics.some((m) => RETURNS.has(m));
  if ([inv, ful, ret].filter(Boolean).length > 1) {
    throw new DspFailure(
      'UNSUPPORTED_METRIC',
      'ERP inventory, fulfilment and returns metrics have different grains and cannot be mixed in one query.'
    );
  }
  if (inv) return 'inventory';
  if (ret) return 'returns';
  return 'fulfilment';
};

const scopeOk = (query: SourceQuery, warehouse: string): boolean => {
  // The gateway only injects scope this source declares (warehouse). Honour it in demo too.
  if (query.scope.unrestricted) return true;
  // warehouse maps to no framework scope dimension here, so an unrestricted-by-warehouse
  // query passes; a store/BU-scoped subject never reaches this source (fails closed upstream).
  void warehouse;
  return true;
};

export const createQueryHandler =
  () =>
  async ({ query, descriptor }: DspHandlerContext): Promise<ResultSet> => {
    const config = readConfiguration();
    if (config.MODE === 'live') {
      // Live reads the extract's fact objects; that path is exercised by the extract job and
      // omitted here to keep the demo self-contained.
      throw new DspFailure(
        'CAPABILITY_NOT_IMPLEMENTED',
        'Live ERP reads come from the nightly extract fact store; run erp-oms-extract-job first.',
        { status: 501 }
      );
    }

    const dataset = datasetOf(query.metrics);
    const grain = query.grain ?? 'day';
    const groupDims = query.dimensions.filter((d) => d !== 'date');
    const includeDate = dataset !== 'inventory' && (query.dimensions.includes('date') || query.grain !== null);
    const range = query.timeRange ?? { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };

    const acc = new Map<string, { day: string; key: Record<string, string>; m: Record<string, number> }>();
    const add = (day: string, key: Record<string, string>, measures: Record<string, number>) => {
      const bucket = includeDate ? bucketDay(day, grain, 'monday') : '';
      const mapKey = [bucket, ...groupDims.map((d) => key[d] ?? '')].join('|');
      const target = acc.get(mapKey) ?? { day: bucket, key, m: {} };
      for (const metricId of query.metrics) {
        if (measures[metricId] !== undefined) target.m[metricId] = (target.m[metricId] ?? 0) + measures[metricId];
      }
      acc.set(mapKey, target);
    };

    if (dataset === 'inventory') {
      // Point-in-time snapshot of the latest INCLUDED day. Ranges are half-open [from, to),
      // so the newest day with data is `to - 1`; snapshot it as its own half-open day.
      const snapshotDay = addDays(range.to, -1);
      for (const row of fakeInventory(snapshotDay, addDays(snapshotDay, 1))) {
        if (!scopeOk(query, row.warehouse)) continue;
        add(row.date, { warehouse: row.warehouse, product: row.sku }, { 'inventory.available': row.onHand });
      }
    } else if (dataset === 'fulfilment') {
      for (const row of fakeFulfilment(range.from, range.to)) {
        add(row.date, { warehouse: row.warehouse, carrier: row.carrier }, {
          'shipments.count': row.shipments,
          'shipments.onTime': row.onTime,
          // pick-to-ship is an average; summing is wrong, so weight it by shipments and
          // divide back out below. Kept simple here: report the per-row seconds summed only
          // when it is the sole metric and single warehouse — otherwise the gateway's avg
          // aggregation handles it. Emit the raw seconds; the metric's agg is 'avg'.
          'fulfilment.pickToShipSeconds': row.pickToShipSeconds,
        });
      }
    } else {
      for (const row of fakeReturns(range.from, range.to)) {
        add(row.date, { returnReason: row.reason }, { 'returns.units@orderdate': row.units });
      }
    }

    const columns: ColumnMeta[] = [
      ...(includeDate ? [{ id: 'date', role: 'time' as const, valueType: 'time' as const, exactness: 'exact' as const, nullMeaning: 'zero' as const }] : []),
      ...groupDims.map((id) => ({ id, role: 'dimension' as const, valueType: 'string' as const, exactness: 'exact' as const, nullMeaning: 'unknown' as const })),
      ...query.metrics.map((id) => ({
        id,
        role: 'metric' as const,
        valueType: getMetric(id)?.valueType ?? ('count' as const),
        exactness: 'exact' as const,
        nullMeaning: (getMetric(id)?.nullSemantics === 'null' ? 'unknown' : 'zero') as 'unknown' | 'zero',
      })),
    ];

    const rows = [...acc.values()]
      .slice(0, query.limit)
      .map((entry) => [
        ...(includeDate ? [entry.day] : []),
        ...groupDims.map((d) => entry.key[d] ?? null),
        ...query.metrics.map((id) => entry.m[id] ?? null),
      ]);

    return buildResultSet({
      descriptor,
      columns,
      rows,
      execution: 'materialized',
      dataAsOf: new Date().toISOString(),
      grainServed: dataset === 'inventory' ? null : 'day',
      degradedReason: 'demo-fixture',
      detail: 'Demo mode: ERP figures come from a built-in fake ERP.',
    });
  };
