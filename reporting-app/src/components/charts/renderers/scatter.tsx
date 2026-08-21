import { useIntl } from 'react-intl';
import type { EChartsOption } from '../echarts-base/register-echarts';
import EChart from '../echarts-base/echart';
import { baseOption, valueAxis } from '../echarts-base/base-option';
import { readChartTheme, type ChartTheme } from '../echarts-base/theme';
import { valueFormatter } from '../echarts-base/format-value';
import { asNumber, columnById } from '../adapters/shape';
import { labelForMetric } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';
import type { Row } from '../../../types/reporting';

/**
 * A scatter/bubble plot for product-performance quadrants — units × margin, bubble = revenue.
 * Median guide lines split it into quadrants, which is how a merchandiser reads "high volume,
 * low margin" at a glance.
 */

export interface ScatterInput {
  spec: ChartSpec;
  columns: ColumnMeta[];
  rows: Row[];
  theme: ChartTheme;
  xLabel: string;
  yLabel: string;
  formatterFor: (id: string) => (value: number) => string;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const buildScatterOption = (input: ScatterInput): EChartsOption => {
  const { spec, rows, theme } = input;
  const xField = spec.encoding.x?.field ?? '';
  const yField = spec.encoding.y?.[0]?.field ?? '';
  const sizeField = spec.encoding.size?.field;
  const pointField = spec.encoding.point?.field;

  const points = rows
    .map((row) => {
      const x = asNumber(row[xField]);
      const y = asNumber(row[yField]);
      if (x === null || y === null) return null;
      const size = sizeField ? asNumber(row[sizeField]) : null;
      const name = pointField ? String(row[pointField] ?? '') : '';
      return { value: [x, y, size ?? 0], name };
    })
    .filter((p): p is { value: number[]; name: string } => p !== null);

  const sizes = points.map((p) => p.value[2]).filter((s) => s > 0);
  const maxSize = sizes.length ? Math.max(...sizes) : 1;

  return {
    ...baseOption(theme),
    tooltip: {
      ...baseOption(theme).tooltip,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number[] };
        return `<strong>${p.name || '—'}</strong><br/>${
          input.xLabel
        }: ${input.formatterFor(xField)(p.value[0])}<br/>${
          input.yLabel
        }: ${input.formatterFor(yField)(p.value[1])}`;
      },
    },
    xAxis: valueAxis(theme, input.formatterFor(xField)),
    yAxis: valueAxis(theme, input.formatterFor(yField)),
    series: [
      {
        type: 'scatter',
        data: points,
        symbolSize: (value: number[]) =>
          sizeField && maxSize ? 8 + (value[2] / maxSize) * 32 : 12,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: theme.axisLine, type: 'dashed' },
          data: [
            { xAxis: median(points.map((p) => p.value[0])) },
            { yAxis: median(points.map((p) => p.value[1])) },
          ],
        },
      },
    ],
  };
};

const Scatter = ({ spec, columns, rows, height }: RendererProps) => {
  const intl = useIntl();
  const option = buildScatterOption({
    spec,
    columns,
    rows,
    theme: readChartTheme(),
    xLabel: labelForMetric(intl, spec.encoding.x?.field ?? ''),
    yLabel: labelForMetric(intl, spec.encoding.y?.[0]?.field ?? ''),
    formatterFor: (id) => valueFormatter(intl, columnById(columns, id)),
  });
  return <EChart option={option} height={height} ariaLabel="scatter plot" />;
};
Scatter.displayName = 'Scatter';

const renderer: Renderer = {
  capabilities: {
    type: 'scatter',
    requires: ['x', 'y'],
    supportsOptions: [],
    supportsComparison: false,
    supportsDrilldown: false,
    libraryFree: false,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    if (!spec.encoding.x || !spec.encoding.y?.length) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A scatter plot needs `x` and `y`.',
      });
    }
    return problems;
  },
  Component: Scatter,
};
export default renderer;
