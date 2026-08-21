import type { ColumnMeta } from '../../../shared/schema/query';
import type { Cell, Row } from '../../../types/reporting';

/**
 * Pure ResultSet → chart-shape adapters.
 *
 * All chart logic that can be tested without a canvas lives here and in each renderer's
 * `buildOption`. These take the tidy long-format rows the gateway returns and reshape them
 * for a specific chart family.
 */

export const asNumber = (value: Cell): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const columnById = (
  columns: ColumnMeta[],
  id: string
): ColumnMeta | undefined => columns.find((c) => c.id === id);

export const timeColumn = (columns: ColumnMeta[]): ColumnMeta | undefined =>
  columns.find((c) => c.role === 'time');

export const firstDimension = (columns: ColumnMeta[]): ColumnMeta | undefined =>
  columns.find((c) => c.role === 'dimension');

/** Distinct values of a field, in first-seen order — stable category ordering. */
export const distinctValues = (rows: Row[], field: string): string[] => {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    const key = String(value);
    if (!set.has(key)) {
      set.add(key);
      seen.push(key);
    }
  }
  return seen;
};

/**
 * A single time series per metric field: [[x, y], ...] sorted by x.
 * Missing points are dropped rather than zero-filled — an absent day is not a zero day.
 */
export const toTimeSeries = (
  rows: Row[],
  timeField: string,
  metricField: string
): Array<[string, number]> =>
  rows
    .map((row) => {
      const x = row[timeField];
      const y = asNumber(row[metricField]);
      return x !== null && x !== undefined && y !== null
        ? ([String(x), y] as [string, number])
        : null;
    })
    .filter((p): p is [string, number] => p !== null)
    .sort((a, b) => a[0].localeCompare(b[0]));

/** Category → value pairs for a single metric, sorted descending, optionally top-N. */
export const toCategorical = (
  rows: Row[],
  categoryField: string,
  metricField: string,
  topN?: number
): Array<{ name: string; value: number }> => {
  const pairs = rows
    .map((row) => {
      const name = row[categoryField];
      const value = asNumber(row[metricField]);
      return name !== null && name !== undefined && value !== null
        ? { name: String(name), value }
        : null;
    })
    .filter((p): p is { name: string; value: number } => p !== null)
    .sort((a, b) => b.value - a.value);
  return topN ? pairs.slice(0, topN) : pairs;
};

/**
 * A matrix for a heatmap: rows × columns with a value at each cell.
 * Returns axis orderings plus ECharts triples [colIndex, rowIndex, value].
 * A missing cell is omitted (rendered blank), never emitted as zero — critical for cohort
 * retention, where a future period genuinely has no value.
 */
export const toMatrix = (
  rows: Row[],
  rowField: string,
  colField: string,
  valueField: string
): {
  rowKeys: string[];
  colKeys: string[];
  points: Array<[number, number, number]>;
} => {
  const rowKeys = distinctValues(rows, rowField);
  const colKeys = distinctValues(rows, colField).sort((a, b) =>
    a.localeCompare(b)
  );
  const rowIndex = new Map(rowKeys.map((k, i) => [k, i]));
  const colIndex = new Map(colKeys.map((k, i) => [k, i]));

  const points: Array<[number, number, number]> = [];
  for (const row of rows) {
    const r = rowIndex.get(String(row[rowField] ?? ''));
    const c = colIndex.get(String(row[colField] ?? ''));
    const v = asNumber(row[valueField]);
    if (r === undefined || c === undefined || v === null) continue;
    points.push([c, r, v]);
  }
  return { rowKeys, colKeys, points };
};

/** Region-code → value for a choropleth. */
export const toRegions = (
  rows: Row[],
  regionField: string,
  valueField: string
): Array<{ name: string; value: number }> =>
  toCategorical(rows, regionField, valueField);
