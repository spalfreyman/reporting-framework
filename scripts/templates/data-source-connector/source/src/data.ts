import type { ColumnMeta, Filter, SourceQuery } from './shared/schema/query.js';
import { readConfiguration } from './env.js';

/**
 * Deterministic synthetic data.
 *
 * Generates plausible, stable figures purely from the query — no external system, no
 * credentials. Replace this file with real upstream calls (an HTTP API, a warehouse query,
 * a live commercetools facet) when you build a real connector; nothing else in the service
 * needs to change.
 *
 * The shape it must return is the DSP tidy-long format: a `columns` list describing each
 * column, and `rows` where each row's cells line up with `columns` in order.
 */

/** Known values for each source-local dimension. `date` is generated from the time range. */
const DIMENSION_VALUES: Record<string, string[]> = {
  channel: ['organic', 'paid', 'email', 'social', 'direct'],
  region: ['EMEA', 'AMER', 'APAC'],
};

/** Per-day baseline for each metric, before seasonality and per-dimension variation. */
const METRIC_BASELINE: Record<string, number> = {
  '__SOURCE_ID__.visits': 1200,
  '__SOURCE_ID__.signups': 48,
  '__SOURCE_ID__.events': 3600,
};

/** Weekday multipliers (Sun..Sat) — a gentle mid-week peak and weekend dip. */
const WEEKDAY = [0.82, 1.0, 1.06, 1.12, 1.16, 1.2, 0.9];

const fnv1a = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};
/** Deterministic value in [0, 1) from a string key. */
const unit = (key: string): number => (fnv1a(key) % 100000) / 100000;

const toUtc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Every day in the half-open range [from, to). */
const eachDay = (from: string, to: string): string[] => {
  const days: string[] = [];
  const end = toUtc(to).getTime();
  for (let t = toUtc(from); t.getTime() < end; t.setUTCDate(t.getUTCDate() + 1)) {
    days.push(isoDay(t));
  }
  return days;
};

/** The bucket-start a given day rolls up into, for the requested grain. */
const bucketStart = (day: string, grain: SourceQuery['grain']): string => {
  const d = toUtc(day);
  switch (grain) {
    case 'week': {
      // ISO-ish week starting Monday.
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
      return isoDay(d);
    }
    case 'month':
      return `${day.slice(0, 7)}-01`;
    case 'quarter': {
      const m = d.getUTCMonth();
      const q = m - (m % 3);
      return `${day.slice(0, 4)}-${String(q + 1).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${day.slice(0, 4)}-01-01`;
    case 'day':
    default:
      return day;
  }
};

/** Apply the query's filters to a dimension's candidate values. */
const applyFilters = (dimension: string, values: string[], filters: Filter[]): string[] => {
  let out = values;
  for (const f of filters) {
    if (f.dimension !== dimension) continue;
    if (f.op === 'in') out = out.filter((v) => f.values.map(String).includes(v));
    else if (f.op === 'notIn') out = out.filter((v) => !f.values.map(String).includes(v));
    else if (f.op === 'eq') out = out.filter((v) => v === String(f.value));
    else if (f.op === 'ne') out = out.filter((v) => v !== String(f.value));
  }
  return out;
};

/** Cartesian product of the requested (non-date) dimensions' value lists. */
const combos = (dims: string[], filters: Filter[]): Record<string, string>[] => {
  let acc: Record<string, string>[] = [{}];
  for (const dim of dims) {
    const values = applyFilters(dim, DIMENSION_VALUES[dim] ?? ['(all)'], filters);
    acc = acc.flatMap((row) => values.map((v) => ({ ...row, [dim]: v })));
  }
  return acc;
};

const metricValue = (metric: string, day: string, combo: Record<string, string>): number => {
  const base = METRIC_BASELINE[metric] ?? 100;
  const weekday = WEEKDAY[toUtc(day).getUTCDay()];
  const comboKey = Object.entries(combo)
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
  // A stable per-combination share, then per-day jitter, then split across combinations.
  const share = 0.4 + 0.9 * unit(`${metric}:${comboKey}`);
  const jitter = 0.85 + 0.3 * unit(`${metric}:${day}:${comboKey}`);
  const divisor = Math.max(1, Object.keys(DIMENSION_VALUES).length ? 1 : 1);
  return Math.max(0, Math.round((base * weekday * share * jitter) / divisor));
};

export interface GeneratedResult {
  columns: ColumnMeta[];
  rows: Array<Array<string | number | null>>;
  truncated: number;
}

/**
 * Build the columns + rows for a query. Metrics and dimensions have already been validated
 * against the descriptor by the DSP harness, so everything requested here is serveable.
 */
export const generateRows = (query: SourceQuery): GeneratedResult => {
  const config = readConfiguration();
  const grain = query.grain ?? 'day';
  const range = query.timeRange ?? { from: isoDay(new Date()), to: isoDay(new Date()) };

  // `date` is implicit for a time series: prepend it unless the caller already asked for it.
  const otherDims = query.dimensions.filter((d) => d !== 'date');
  const hasDate = query.dimensions.includes('date') || query.grain !== null;
  const dimColumns = hasDate ? ['date', ...otherDims] : otherDims;

  // Accumulate metric sums per (bucket-start × dimension combination).
  const acc = new Map<string, { key: Record<string, string>; metrics: Record<string, number> }>();
  const days = eachDay(range.from, range.to);
  for (const combo of combos(otherDims, query.filters)) {
    for (const day of days) {
      const bucket = hasDate ? bucketStart(day, grain) : '__all__';
      const key: Record<string, string> = { ...combo, ...(hasDate ? { date: bucket } : {}) };
      const rowKey = JSON.stringify(key);
      let entry = acc.get(rowKey);
      if (!entry) {
        entry = { key, metrics: Object.fromEntries(query.metrics.map((m) => [m, 0])) };
        acc.set(rowKey, entry);
      }
      for (const m of query.metrics) entry.metrics[m] += metricValue(m, day, combo);
    }
  }

  const columns: ColumnMeta[] = [
    ...dimColumns.map((id) => ({
      id,
      role: id === 'date' ? ('time' as const) : ('dimension' as const),
      valueType: id === 'date' ? ('time' as const) : ('string' as const),
      exactness: 'exact' as const,
      nullMeaning: 'unknown' as const,
    })),
    ...query.metrics.map((id) => ({
      id,
      role: 'metric' as const,
      valueType: 'count' as const,
      exactness: 'exact' as const,
      nullMeaning: 'zero' as const,
    })),
  ];

  let entries = [...acc.values()];
  // Stable ordering: by date then dimension values, so repeat calls are byte-identical.
  entries.sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));

  const total = entries.length;
  const truncated = Math.max(0, total - query.limit);
  if (truncated > 0) entries = entries.slice(0, query.limit);

  const rows = entries.map((e) => [
    ...dimColumns.map((d) => e.key[d] ?? null),
    ...query.metrics.map((m) => e.metrics[m]),
  ]);

  // config is read to honour DATA_SEED / timezone in a real build; referenced to keep the
  // deterministic-by-config intent explicit.
  void config.DATA_SEED;

  return { columns, rows, truncated };
};
