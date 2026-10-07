import { z } from 'zod';
import { grainSchema } from './query';

/**
 * ChartSpec describes INTENT, never library options.
 *
 * No `series`, no `xAxis`, no `option` key ever appears in a stored report. That is the
 * whole insurance policy: swapping charting library means writing new renderers, not
 * rewriting reports.
 */

export const CHART_TYPES = [
  'kpi',
  'sparkline',
  'timeseries',
  'breakdown',
  'treemap',
  'donut',
  'funnel',
  'heatmap',
  'histogram',
  'scatter',
  'geo',
  'pivot',
  'table',
  /** Escape hatch for power users. Not used by any built-in report. */
  'vega-lite',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

const fieldRef = z.object({
  field: z.string(),
  /** 'left' | 'right' for dual-axis charts. */
  axis: z.enum(['left', 'right']).optional(),
  mark: z.enum(['line', 'area', 'bar']).optional(),
  /** Pull this series from the comparison period rather than the primary. */
  from: z.enum(['primary', 'comparison']).default('primary'),
});

const chartOptions = z
  .object({
    stacked: z.boolean().optional(),
    /** 100% stacked — share of mix. */
    normalise: z.boolean().optional(),
    dualAxis: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    showDataLabels: z.boolean().optional(),
    /** Render the comparison period as a dashed ghost series. */
    showComparisonGhost: z.boolean().optional(),
    /**
     * Whether a rising value is good. Without this, every "improvement" in a bad metric
     * (return rate, refund rate) renders as success.
     */
    goodDirection: z.enum(['up', 'down', 'neutral']).optional(),
    topN: z.number().int().positive().optional(),
    otherBucket: z.boolean().optional(),
    binCount: z.number().int().positive().optional(),
    maxSlices: z.number().int().positive().optional(),
    yZero: z.boolean().optional(),
    colourScale: z.enum(['sequential', 'diverging', 'categorical']).optional(),
    pageSize: z.number().int().positive().optional(),
    totalsRow: z.boolean().optional(),
    map: z.enum(['world', 'europe', 'us', 'gb']).optional(),
  })
  .default({});

export const chartSpecSchema = z.object({
  specVersion: z.literal(1),
  type: z.enum(CHART_TYPES),
  encoding: z
    .object({
      x: fieldRef.optional(),
      y: z.array(fieldRef).optional(),
      series: fieldRef.optional(),
      /** kpi / sparkline */
      value: fieldRef.optional(),
      compare: fieldRef.optional(),
      trend: z.object({ field: z.string(), over: z.string(), grain: grainSchema.optional() }).optional(),
      /** breakdown / donut / treemap */
      category: fieldRef.optional(),
      parent: fieldRef.optional(),
      /** scatter */
      size: fieldRef.optional(),
      colour: fieldRef.optional(),
      point: fieldRef.optional(),
      /** heatmap / pivot */
      row: fieldRef.optional(),
      column: fieldRef.optional(),
      /** funnel */
      steps: z.array(z.string()).optional(),
      /** geo */
      region: fieldRef.optional(),
      /** table / pivot */
      columns: z.array(fieldRef).optional(),
      values: z.array(fieldRef).optional(),
    })
    .default({}),
  options: chartOptions,
  /** Only read when type is 'vega-lite'. */
  vegaLiteSpec: z.record(z.unknown()).optional(),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;
