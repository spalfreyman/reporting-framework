import type { ChartType } from '../../shared/schema/chart-spec';
import type { Renderer } from './types';

/**
 * The renderer registry, lazily loaded.
 *
 * Every entry is a dynamic import, so a report made of KPI tiles and a table pulls ZERO
 * ECharts bytes: the trading dashboard's first paint is four KPI tiles, and the operator
 * should not wait on a charting library to see them. The ECharts-backed modules only load
 * when a report actually uses that chart type.
 */
export const CHART_RENDERERS: Partial<
  Record<ChartType, () => Promise<{ default: Renderer }>>
> = {
  // Library-free: plain SVG and UI Kit.
  kpi: () => import('./renderers/kpi-stat'),
  sparkline: () => import('./renderers/sparkline'),
  table: () => import('./renderers/data-table'),
  pivot: () => import('./renderers/pivot-table'),

  // ECharts-backed (each import pulls the charting library into its own lazy chunk).
  timeseries: () => import('./renderers/time-series'),
  breakdown: () => import('./renderers/breakdown'),
  donut: () =>
    import('./renderers/breakdown').then((m) => ({ default: m.donutRenderer })),
  treemap: () =>
    import('./renderers/breakdown').then((m) => ({
      default: m.treemapRenderer,
    })),
  funnel: () => import('./renderers/funnel'),
  heatmap: () => import('./renderers/cohort-heatmap'),
  histogram: () => import('./renderers/histogram'),
  scatter: () => import('./renderers/scatter'),
  geo: () => import('./renderers/geo-choropleth'),
};

const cache = new Map<ChartType, Renderer>();

export const loadRenderer = async (
  type: ChartType
): Promise<Renderer | null> => {
  const cached = cache.get(type);
  if (cached) return cached;

  const loader = CHART_RENDERERS[type];
  if (!loader) return null;

  const module = await loader();
  cache.set(type, module.default);
  return module.default;
};

export const isRendererAvailable = (type: ChartType): boolean =>
  Boolean(CHART_RENDERERS[type]);
