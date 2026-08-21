import type { ComponentType } from 'react';
import type { ChartSpec, ChartType } from '../../shared/schema/chart-spec';
import type { ColumnMeta, DateRange } from '../../shared/schema/query';
import type { Cell, Row } from '../../types/reporting';

/**
 * The renderer contract.
 *
 * A stored ChartSpec describes INTENT — no `series`, no `xAxis`, no library option object
 * ever appears in a report definition. That is the whole insurance policy: swapping charting
 * library means writing new renderers, not rewriting reports.
 *
 * `capabilities` does double duty. It validates a spec at render time, and it also drives
 * the report builder's UI, so the builder cannot author a chart the renderer will not draw.
 */

export type RendererCapabilities = {
  type: ChartType;
  /** Encoding keys this renderer needs to draw anything at all. */
  requires: Array<keyof ChartSpec['encoding']>;
  supportsOptions: Array<keyof NonNullable<ChartSpec['options']>>;
  maxSeries?: number;
  supportsComparison: boolean;
  supportsDrilldown: boolean;
  /** True when the renderer needs no charting library, so the tile stays tiny. */
  libraryFree: boolean;
};

export type RendererProps = {
  spec: ChartSpec;
  columns: ColumnMeta[];
  rows: Row[];
  totals: Record<string, Cell>;
  comparison?: { range: DateRange; rows: Row[]; totals: Record<string, Cell> };
  height: number;
  onDrilldown?: (dimensionValues: Record<string, string>) => void;
};

export type SpecProblem = { code: string; message: string };

export type Renderer = {
  capabilities: RendererCapabilities;
  /** Static validation, run in the builder AND before render. */
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => SpecProblem[];
  Component: ComponentType<RendererProps>;
};

/** Shared validation: every field a spec encodes must exist in the result set. */
export const validateEncodedFields = (
  spec: ChartSpec,
  columns: ColumnMeta[]
): SpecProblem[] => {
  const available = new Set(columns.map((c) => c.id));
  const encoded = [
    ...JSON.stringify(spec.encoding).matchAll(/"field":"([^"]+)"/g),
  ].map(([, field]) => field);
  return [...new Set(encoded)]
    .filter((field) => !available.has(field))
    .map((field) => ({
      code: 'FIELD_NOT_IN_RESULT',
      message: `The chart encodes "${field}", which this tile's query does not select.`,
    }));
};
