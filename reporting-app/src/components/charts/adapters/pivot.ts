import type { ColumnMeta } from '../../../shared/schema/query';
import { asNumber, distinctValues } from './shape';
import type { Cell, Row } from '../../../types/reporting';

/**
 * Pivots tidy long-format rows into a rows × columns grid for one measure.
 *
 * Pure and canvas-free, so it is unit-tested directly. Subtotals per row and a grand total
 * are computed by SUMMING the measure — which is only valid for an additive measure; the
 * renderer refuses to total a non-additive one rather than showing a wrong subtotal.
 */

export interface PivotResult {
  rowKeys: string[];
  colKeys: string[];
  /** cell[rowKey][colKey] = value (or null when absent). */
  cell: Record<string, Record<string, number | null>>;
  rowTotals: Record<string, number | null>;
  colTotals: Record<string, number | null>;
  grandTotal: number | null;
}

export const pivot = (
  rows: Row[],
  rowField: string,
  colField: string,
  valueField: string,
  additive: boolean
): PivotResult => {
  const rowKeys = distinctValues(rows, rowField);
  const colKeys = distinctValues(rows, colField);
  const cell: Record<string, Record<string, number | null>> = {};
  for (const rk of rowKeys)
    cell[rk] = Object.fromEntries(colKeys.map((ck) => [ck, null]));

  for (const row of rows) {
    const rk = String(row[rowField] ?? '');
    const ck = String(row[colField] ?? '');
    const v = asNumber(row[valueField]);
    if (!(rk in cell) || !(ck in cell[rk]) || v === null) continue;
    cell[rk][ck] = (cell[rk][ck] ?? 0) + v;
  }

  const sumRow = (rk: string): number | null => {
    if (!additive) return null;
    const vals = colKeys
      .map((ck) => cell[rk][ck])
      .filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const sumCol = (ck: string): number | null => {
    if (!additive) return null;
    const vals = rowKeys
      .map((rk) => cell[rk][ck])
      .filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const rowTotals = Object.fromEntries(rowKeys.map((rk) => [rk, sumRow(rk)]));
  const colTotals = Object.fromEntries(colKeys.map((ck) => [ck, sumCol(ck)]));
  const grandTotal = additive
    ? Object.values(rowTotals).reduce<number | null>(
        (acc, v) => (v === null ? acc : (acc ?? 0) + v),
        null
      )
    : null;

  return { rowKeys, colKeys, cell, rowTotals, colTotals, grandTotal };
};

export const isAdditiveColumn = (column: ColumnMeta | undefined): boolean =>
  // Only count/money metrics are safe to subtotal by summing; ratios/percents are not.
  column?.valueType === 'count' || column?.valueType === 'money';

export type { Cell };
