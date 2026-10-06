import type { ColumnMeta, ResultSet } from '../schema/query.js';
import { evaluateFormula } from '../semantic/formula.js';
import { getMetric } from '../semantic/metrics.js';
import type { DerivedMetric, Grain } from '../semantic/types.js';
import { bucketDay } from '../util/date-range.js';

/**
 * Merge, roll up, derive, post-process.
 *
 * The order is NOT negotiable:
 *   1. FULL OUTER join on the join key
 *   2. Time roll-up to the effective grain (additive metrics only)
 *   3. Evaluate derived formulas - ratio of sums, never sum of ratios
 *   4. having / topN / sort / limit
 *   5. Totals row (ratios recomputed from summed components, never averaged)
 */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

/** ASCII unit separator: cannot occur in a dimension value, so composite keys are unambiguous. */
const SEP = String.fromCharCode(31);

export interface MergeNotice {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface MergeInput {
  sourceId: string;
  resultSet: ResultSet;
}

export interface MergeResult {
  columns: ColumnMeta[];
  rows: Row[];
  totals: Record<string, Cell>;
  notices: MergeNotice[];
  /** MIN across every contributor. Reporting the freshest lag would misrepresent the tile. */
  dataAsOf: string | null;
  contributions: Array<{ sourceId: string; metrics: string[]; dataAsOf: string; status: string }>;
}

const toRows = (resultSet: ResultSet): Row[] =>
  resultSet.rows.map((cells) => {
    const row: Row = {};
    resultSet.columns.forEach((column, index) => {
      row[column.id] = cells[index] ?? null;
    });
    return row;
  });

const keyOf = (row: Row, joinKey: string[]): string =>
  joinKey.map((k) => String(row[k] ?? '')).join(SEP);

const asNumber = (value: Cell): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * Collapses rows that share a join key.
 *
 * The FAN-OUT GUARD: if a source returns finer dimensions than the join key, we aggregate
 * down using each metric's declared aggregation - and refuse when the metric is not
 * additive over the collapsed dimension. Unguarded fan-out is the classic
 * 3x-inflated-revenue bug.
 */
const collapseToJoinKey = (
  rows: Row[],
  joinKey: string[],
  metricIds: string[],
  sourceId: string,
  notices: MergeNotice[]
): Map<string, Row> => {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row, joinKey);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const out = new Map<string, Row>();
  const refusedMetrics = new Set<string>();

  for (const [key, group] of grouped) {
    if (group.length === 1) {
      out.set(key, group[0]);
      continue;
    }

    const merged: Row = {};
    for (const k of joinKey) merged[k] = group[0][k] ?? null;

    for (const metricId of metricIds) {
      const def = getMetric(metricId);
      const values = group.map((r) => asNumber(r[metricId])).filter((v): v is number => v !== null);

      if (!def || def.kind !== 'base') {
        merged[metricId] = values.length > 0 ? values[0] : null;
        continue;
      }

      if (!def.additive.overDimensions && def.aggregation !== 'avg') {
        refusedMetrics.add(metricId);
        merged[metricId] = null;
        continue;
      }

      if (values.length === 0) {
        merged[metricId] = null;
        continue;
      }

      switch (def.aggregation) {
        case 'min':
          merged[metricId] = Math.min(...values);
          break;
        case 'max':
          merged[metricId] = Math.max(...values);
          break;
        case 'avg':
          merged[metricId] = sum(values) / values.length;
          break;
        default:
          merged[metricId] = sum(values);
      }
    }
    out.set(key, merged);
  }

  if (refusedMetrics.size > 0) {
    notices.push({
      severity: 'error',
      code: 'FAN_OUT_REFUSED',
      message:
        `${sourceId} returned multiple rows per join key for ${[...refusedMetrics].join(', ')}, ` +
        `which is not additive over the collapsed dimension. Refusing to aggregate rather than ` +
        `inflate the figure.`,
    });
  }

  return out;
};

export interface MergeOptions {
  joinKey: string[];
  /** Base metric ids expected in the joined output. */
  baseMetrics: string[];
  derived: Array<{ id: string; def: DerivedMetric }>;
  effectiveGrain: Grain | null;
  weekStart?: 'monday' | 'sunday';
  topN?: { by: string; n: number; otherBucket: boolean };
  having?: Array<{ metric: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }>;
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
  limit?: number;
}

const applyDerived = (row: Row, derived: Array<{ id: string; def: DerivedMetric }>): void => {
  const inputs: Record<string, number | null> = {};
  for (const key of Object.keys(row)) inputs[key] = asNumber(row[key]);
  for (const { id, def } of derived) {
    row[id] = evaluateFormula(def.formula, inputs);
  }
};

export const mergeResults = (inputs: MergeInput[], options: MergeOptions): MergeResult => {
  const notices: MergeNotice[] = [];
  const { joinKey, baseMetrics, derived, effectiveGrain } = options;

  const contributions = inputs.map(({ sourceId, resultSet }) => ({
    sourceId,
    metrics: resultSet.columns.filter((c) => c.role === 'metric').map((c) => c.id),
    dataAsOf: resultSet.provenance.dataAsOf,
    status: resultSet.status,
  }));

  // 1. FULL OUTER join. An inner join silently drops days one source has and another does
  // not, which shows up as a mysteriously short chart. Every key from every source lives.
  const joined = new Map<string, Row>();
  const columnById = new Map<string, ColumnMeta>();

  for (const { sourceId, resultSet } of inputs) {
    for (const column of resultSet.columns) {
      if (!columnById.has(column.id)) columnById.set(column.id, column);
    }
    const sourceMetrics = resultSet.columns.filter((c) => c.role === 'metric').map((c) => c.id);
    const collapsed = collapseToJoinKey(
      toRows(resultSet),
      joinKey,
      sourceMetrics,
      sourceId,
      notices
    );

    for (const [key, row] of collapsed) {
      const existing = joined.get(key);
      if (!existing) {
        joined.set(key, { ...row });
        continue;
      }
      // Merge measures in; join-key columns already agree by construction.
      for (const [field, value] of Object.entries(row)) {
        if (joinKey.includes(field)) continue;
        existing[field] = value;
      }
    }
  }

  let rows = [...joined.values()];

  // 2. Time roll-up.
  const needsRollUp =
    effectiveGrain !== null &&
    effectiveGrain !== 'hour' &&
    effectiveGrain !== 'day' &&
    joinKey.includes('date');

  if (needsRollUp) {
    const grain = effectiveGrain as Grain;
    const nonAdditive = baseMetrics.filter((id) => {
      const def = getMetric(id);
      return def?.kind === 'base' && !def.additive.overTime;
    });
    if (nonAdditive.length > 0) {
      notices.push({
        severity: 'warning',
        code: 'NON_ADDITIVE_ROLLUP',
        message:
          `${nonAdditive.join(', ')} cannot be rolled up over time (monthly uniques are not the ` +
          `sum of daily uniques), so they are omitted at ${grain} grain.`,
      });
    }

    const groupKey = joinKey.filter((k) => k !== 'date');
    const bucketed = new Map<string, Row>();

    for (const row of rows) {
      const day = typeof row.date === 'string' ? row.date : null;
      if (!day) continue;
      const bucket = bucketDay(day, grain, options.weekStart ?? 'monday');
      const key = [bucket, ...groupKey.map((k) => String(row[k] ?? ''))].join(SEP);
      const existing = bucketed.get(key);

      if (!existing) {
        const seed: Row = { date: bucket };
        for (const k of groupKey) seed[k] = row[k] ?? null;
        for (const metricId of baseMetrics) {
          seed[metricId] = nonAdditive.includes(metricId) ? null : (row[metricId] ?? null);
        }
        bucketed.set(key, seed);
        continue;
      }

      for (const metricId of baseMetrics) {
        if (nonAdditive.includes(metricId)) continue;
        const left = asNumber(existing[metricId]);
        const right = asNumber(row[metricId]);
        existing[metricId] = left === null && right === null ? null : (left ?? 0) + (right ?? 0);
      }
    }
    rows = [...bucketed.values()];
  }

  // 3. Derived metrics, evaluated AFTER aggregation.
  for (const row of rows) applyDerived(row, derived);

  // 4. having / topN / sort / limit.
  if (options.having && options.having.length > 0) {
    const predicates = options.having;
    rows = rows.filter((row) =>
      predicates.every(({ metric, op, value }) => {
        const actual = asNumber(row[metric]);
        if (actual === null) return false;
        if (op === 'gt') return actual > value;
        if (op === 'gte') return actual >= value;
        if (op === 'lt') return actual < value;
        return actual <= value;
      })
    );
  }

  if (options.topN) {
    const { by, n, otherBucket } = options.topN;
    const byDef = getMetric(by);
    const byIsAdditive = byDef?.kind === 'base' ? byDef.additive.overDimensions : false;
    const sorted = [...rows].sort(
      (a, b) => (asNumber(b[by]) ?? -Infinity) - (asNumber(a[by]) ?? -Infinity)
    );
    const head = sorted.slice(0, n);
    const tail = sorted.slice(n);

    if (tail.length > 0 && otherBucket) {
      if (!byIsAdditive) {
        notices.push({
          severity: 'warning',
          code: 'OTHER_BUCKET_SKIPPED',
          message:
            `The "Other" bucket is omitted because ${by} is not additive across dimensions, ` +
            `so the residual cannot be obtained by summing.`,
        });
      } else {
        const other: Row = {};
        for (const k of joinKey) other[k] = k === 'date' ? null : '__other__';
        for (const metricId of baseMetrics) {
          const def = getMetric(metricId);
          other[metricId] =
            def?.kind === 'base' && def.additive.overDimensions
              ? sum(tail.map((r) => asNumber(r[metricId]) ?? 0))
              : null;
        }
        applyDerived(other, derived);
        head.push(other);
      }
    }
    rows = head;
  }

  if (options.orderBy && options.orderBy.length > 0) {
    const orderBy = options.orderBy;
    rows = [...rows].sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const an = asNumber(a[column]);
        const bn = asNumber(b[column]);
        const cmp =
          an !== null && bn !== null
            ? an - bn
            : String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  if (options.limit !== undefined && rows.length > options.limit) {
    notices.push({
      severity: 'info',
      code: 'LIMIT_TRUNCATED',
      message: `Showing the first ${options.limit} of ${rows.length} rows.`,
    });
    rows = rows.slice(0, options.limit);
  }

  // 5. Totals. Additive metrics are summed; ratios are RECOMPUTED from the summed
  // components, because averaging a column of ratios is simply the wrong number.
  const totals: Record<string, Cell> = {};
  for (const metricId of baseMetrics) {
    const def = getMetric(metricId);
    if (def?.kind !== 'base' || !def.additive.overDimensions) {
      totals[metricId] = null;
      continue;
    }
    const values = rows.map((r) => asNumber(r[metricId])).filter((v): v is number => v !== null);
    totals[metricId] = values.length > 0 ? sum(values) : null;
  }
  applyDerived(totals as Row, derived);

  const anySampled = inputs.some((i) =>
    i.resultSet.columns.some((c) => c.role === 'metric' && c.exactness !== 'exact')
  );

  const columns: ColumnMeta[] = [
    ...joinKey.map(
      (id): ColumnMeta =>
        columnById.get(id) ?? {
          id,
          role: id === 'date' ? 'time' : 'dimension',
          valueType: id === 'date' ? 'time' : 'string',
          exactness: 'exact',
          nullMeaning: 'unknown',
        }
    ),
    ...baseMetrics.map(
      (id): ColumnMeta =>
        columnById.get(id) ?? {
          id,
          role: 'metric',
          valueType: getMetric(id)?.valueType ?? 'count',
          exactness: 'exact',
          nullMeaning: 'zero',
        }
    ),
    // A cross-source derived metric is only ever as exact as its least exact input.
    ...derived.map(
      ({ id, def }): ColumnMeta => ({
        id,
        role: 'metric',
        valueType: def.valueType,
        exactness: anySampled ? 'estimated' : 'exact',
        nullMeaning: 'unknown',
      })
    ),
  ];

  const asOfValues = inputs
    .map((i) => i.resultSet.provenance.dataAsOf)
    .filter((v): v is string => Boolean(v))
    .sort();

  return {
    columns,
    rows,
    totals,
    notices,
    dataAsOf: asOfValues.length > 0 ? asOfValues[0] : null,
    contributions,
  };
};
