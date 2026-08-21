import {
  reportDefinitionSchema,
  type ReportDefinition,
} from '../../shared/schema/report-definition';
import { getMetric } from '../../shared/semantic/metrics';
import { getDimension } from '../../shared/semantic/dimensions';
import type { ChartType } from '../../shared/schema/chart-spec';
import type { Grain } from '../../shared/semantic/types';

/**
 * The builder's working model, and the mapping to a real ReportDefinition.
 *
 * The builder edits this flat shape; `toDefinition` assembles the nested definition and runs
 * it through the same zod schema everything else uses, so the builder cannot produce a report
 * the gateway would reject. `describeProblems` turns a failed parse into human sentences for
 * the form.
 */

export interface DraftTile {
  id: string;
  title: string;
  chartType: ChartType;
  metrics: string[];
  dimensions: string[];
}

export interface DraftReport {
  id: string;
  title: string;
  category: ReportDefinition['category'];
  datePreset: string;
  grain: Grain;
  tiles: DraftTile[];
}

export const CATEGORIES: ReportDefinition['category'][] = [
  'trading',
  'merchandising',
  'customer',
  'marketing',
  'promotions',
  'operations',
  'inventory',
];

export const emptyTile = (n: number): DraftTile => ({
  id: `tile-${n}`,
  title: '',
  chartType: 'kpi',
  metrics: [],
  dimensions: [],
});

export const emptyDraft = (): DraftReport => ({
  id: '',
  title: '',
  category: 'trading',
  datePreset: 'last28d',
  grain: 'day',
  tiles: [emptyTile(1)],
});

/** How wide a tile is, by chart type — KPIs are small, most charts full width. */
const spanFor = (type: ChartType): 1 | 2 | 3 | 4 | 6 | 12 =>
  type === 'kpi' || type === 'sparkline'
    ? 3
    : type === 'table' || type === 'pivot'
    ? 12
    : 6;

/** Builds the chart encoding for a tile from its metrics/dimensions. */
const encodingFor = (tile: DraftTile) => {
  const [firstMetric] = tile.metrics;
  const [firstDim] = tile.dimensions;
  switch (tile.chartType) {
    case 'kpi':
    case 'sparkline':
      return { value: { field: firstMetric, from: 'primary' as const } };
    case 'timeseries':
      return {
        x: { field: 'date', from: 'primary' as const },
        y: tile.metrics.map((f) => ({
          field: f,
          from: 'primary' as const,
          mark: 'line' as const,
        })),
      };
    case 'breakdown':
    case 'donut':
    case 'treemap':
      return {
        category: { field: firstDim, from: 'primary' as const },
        y: tile.metrics.map((f) => ({ field: f, from: 'primary' as const })),
        value: { field: firstMetric, from: 'primary' as const },
      };
    case 'funnel':
      return { steps: tile.metrics };
    case 'heatmap':
      return {
        row: { field: tile.dimensions[0], from: 'primary' as const },
        column: { field: tile.dimensions[1], from: 'primary' as const },
        value: { field: firstMetric, from: 'primary' as const },
      };
    case 'histogram':
      return {
        category: { field: firstDim, from: 'primary' as const },
        value: { field: firstMetric, from: 'primary' as const },
      };
    case 'scatter':
      return {
        x: { field: tile.metrics[0], from: 'primary' as const },
        y: [{ field: tile.metrics[1], from: 'primary' as const }],
        point: firstDim
          ? { field: firstDim, from: 'primary' as const }
          : undefined,
      };
    case 'geo':
      return {
        region: { field: firstDim, from: 'primary' as const },
        value: { field: firstMetric, from: 'primary' as const },
      };
    case 'pivot':
      return {
        row: { field: tile.dimensions[0], from: 'primary' as const },
        column: { field: tile.dimensions[1], from: 'primary' as const },
        values: [{ field: firstMetric, from: 'primary' as const }],
      };
    case 'table':
      return {
        columns: [...tile.dimensions, ...tile.metrics].map((f) => ({
          field: f,
          from: 'primary' as const,
        })),
      };
    default:
      return {};
  }
};

export const toDefinition = (draft: DraftReport): ReportDefinition => {
  const allMetrics = [...new Set(draft.tiles.flatMap((t) => t.metrics))];
  const raw = {
    schemaVersion: 1,
    id: draft.id.startsWith('custom.') ? draft.id : `custom.${draft.id}`,
    version: 1,
    origin: 'custom',
    title: { en: draft.title || draft.id },
    category: draft.category,
    audience: [],
    requiredCapabilities: {
      metrics: allMetrics,
      sourceKinds: [],
      permissions: [],
    },
    optionalMetrics: [],
    failurePolicy: 'lenient',
    defaults: {
      datePreset: draft.datePreset,
      grain: draft.grain,
      timezone: 'project',
      weekStart: 'monday',
      comparison: { kind: 'previousPeriod', alignBy: 'weekday' },
      fx: { mode: 'none', rateDate: 'transactionDate' },
      filters: [],
    },
    allowedFilters: [],
    freshness: { showAsOf: true },
    layout: {
      rows: draft.tiles.map((t, i) => ({ id: `r${i}`, tileIds: [t.id] })),
    },
    tiles: draft.tiles.map((tile) => ({
      id: tile.id,
      title: { en: tile.title || tile.id },
      span: spanFor(tile.chartType),
      query: {
        metrics: tile.metrics,
        dimensions: tile.dimensions,
        grain: tile.chartType === 'kpi' ? 'inherit' : 'inherit',
        comparison: tile.chartType === 'kpi' ? 'inherit' : 'none',
      },
      chart: {
        specVersion: 1,
        type: tile.chartType,
        encoding: encodingFor(tile),
        options: {},
      },
    })),
  };
  return reportDefinitionSchema.parse(raw);
};

/** Cheap, human-facing pre-checks the form shows before attempting a schema parse. */
export const describeProblems = (draft: DraftReport): string[] => {
  const problems: string[] = [];
  if (!draft.id.trim()) problems.push('Give the report an id.');
  if (
    !/^[a-z0-9.-]+$/.test(draft.id.replace(/^custom\./, '')) &&
    draft.id.trim()
  )
    problems.push(
      'The id may use only lowercase letters, digits, dots and hyphens.'
    );
  if (draft.tiles.length === 0) problems.push('Add at least one tile.');

  draft.tiles.forEach((tile, i) => {
    const where = tile.title || `tile ${i + 1}`;
    if (tile.metrics.length === 0)
      problems.push(`${where}: choose at least one metric.`);
    for (const m of tile.metrics)
      if (!getMetric(m)) problems.push(`${where}: unknown metric "${m}".`);
    for (const d of tile.dimensions)
      if (!getDimension(d))
        problems.push(`${where}: unknown dimension "${d}".`);
    if (
      (tile.chartType === 'breakdown' ||
        tile.chartType === 'donut' ||
        tile.chartType === 'treemap' ||
        tile.chartType === 'histogram' ||
        tile.chartType === 'geo') &&
      tile.dimensions.length === 0
    )
      problems.push(`${where}: a ${tile.chartType} needs a dimension.`);
    if (
      (tile.chartType === 'heatmap' || tile.chartType === 'pivot') &&
      tile.dimensions.length < 2
    )
      problems.push(
        `${where}: a ${tile.chartType} needs two dimensions (row and column).`
      );
    if (tile.chartType === 'scatter' && tile.metrics.length < 2)
      problems.push(`${where}: a scatter plot needs two metrics (x and y).`);
    if (tile.chartType === 'funnel' && tile.metrics.length < 2)
      problems.push(`${where}: a funnel needs at least two step metrics.`);
  });
  return problems;
};
