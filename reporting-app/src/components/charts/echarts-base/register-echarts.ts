/**
 * Explicit ECharts registration.
 *
 * ECharts is imported piece by piece from `echarts/core` rather than as the monolith, so the
 * bundle carries only the chart types and components actually used. Adding a new chart type
 * means adding its import here — nothing is pulled in implicitly.
 *
 * This module is only ever imported by renderer modules, which the registry loads lazily, so
 * none of it reaches a report made solely of KPI tiles and tables.
 */
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  TreemapChart,
  FunnelChart,
  HeatmapChart,
  ScatterChart,
  MapChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  DataZoomComponent,
  MarkLineComponent,
  VisualMapComponent,
  AriaComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

let registered = false;

/** Registers the ECharts modules once. Safe to call from every renderer. */
export const ensureEchartsRegistered = (): void => {
  if (registered) return;
  echarts.use([
    BarChart,
    LineChart,
    PieChart,
    TreemapChart,
    FunnelChart,
    HeatmapChart,
    ScatterChart,
    MapChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    DatasetComponent,
    DataZoomComponent,
    MarkLineComponent,
    VisualMapComponent,
    AriaComponent,
    TitleComponent,
    CanvasRenderer,
  ]);
  registered = true;
};

export { echarts };
// Type-only: the composed option object type. Erased at build, so no runtime cost, and
// unlike the setOption parameter type it is a plain object that can be spread.
export type { EChartsOption } from 'echarts';
