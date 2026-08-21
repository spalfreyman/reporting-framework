import { useIntl } from 'react-intl';
import type { EChartsOption } from '../echarts-base/register-echarts';
import EChart from '../echarts-base/echart';
import { baseOption } from '../echarts-base/base-option';
import { readChartTheme, type ChartTheme } from '../echarts-base/theme';
import { columnById, toMatrix } from '../adapters/shape';
import { labelForDimension, formatCell } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';
import type { IntlShape } from 'react-intl';
import type { Row } from '../../../types/reporting';

/**
 * A cohort/retention heatmap: acquisition cohort (rows) × period index (columns), coloured
 * by a value (retention rate, revenue).
 *
 * The one thing that must be right: a cell with no data is left BLANK, never coloured as
 * zero. A three-month-old cohort has no month-six figure — painting that as 0% retention is
 * the single most common cohort-chart lie, and `toMatrix` omits missing cells for exactly
 * this reason.
 */

export interface HeatmapInput {
  spec: ChartSpec;
  columns: ColumnMeta[];
  rows: Row[];
  theme: ChartTheme;
  rowLabel: string;
  colLabel: string;
  formatValue: (value: number) => string;
}

export const buildHeatmapOption = (input: HeatmapInput): EChartsOption => {
  const { spec, rows, theme } = input;
  const rowField = spec.encoding.row?.field ?? '';
  const colField = spec.encoding.column?.field ?? '';
  const valueField =
    spec.encoding.value?.field ?? spec.encoding.y?.[0]?.field ?? '';

  const { rowKeys, colKeys, points } = toMatrix(
    rows,
    rowField,
    colField,
    valueField
  );
  const values = points.map((p) => p[2]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;

  return {
    ...baseOption(theme),
    grid: { left: 8, right: 8, top: 8, bottom: 48, containLabel: true },
    tooltip: {
      ...baseOption(theme).tooltip,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { value: [number, number, number] };
        const [c, r, v] = p.value;
        return `${rowKeys[r]} · ${colKeys[c]}<br/><strong>${input.formatValue(
          v
        )}</strong>`;
      },
    },
    xAxis: {
      type: 'category',
      data: colKeys,
      splitArea: { show: true },
      axisLabel: { color: theme.axisLabel },
    },
    yAxis: {
      type: 'category',
      data: rowKeys,
      splitArea: { show: true },
      axisLabel: { color: theme.axisLabel },
    },
    visualMap: {
      min,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 8,
      inRange: { color: theme.sequential },
      textStyle: { color: theme.textSecondary },
    },
    series: [
      {
        type: 'heatmap',
        data: points,
        // Missing cells are simply absent from `points`, so they render as the empty grid.
        label: { show: false },
        emphasis: { itemStyle: { shadowBlur: 6 } },
      },
    ],
  };
};

const CohortHeatmap = ({ spec, columns, rows, height }: RendererProps) => {
  const intl = useIntl();
  const valueField =
    spec.encoding.value?.field ?? spec.encoding.y?.[0]?.field ?? '';
  const valueColumn = columnById(columns, valueField);
  const option = buildHeatmapOption({
    spec,
    columns,
    rows,
    theme: readChartTheme(),
    rowLabel: labelForDimension(intl, spec.encoding.row?.field ?? ''),
    colLabel: labelForDimension(intl, spec.encoding.column?.field ?? ''),
    formatValue: (v) =>
      valueColumn
        ? formatCell(intl as IntlShape, valueColumn, v)
        : intl.formatNumber(v),
  });
  return <EChart option={option} height={height} ariaLabel="cohort heatmap" />;
};
CohortHeatmap.displayName = 'CohortHeatmap';

const renderer: Renderer = {
  capabilities: {
    type: 'heatmap',
    requires: ['row', 'column', 'value'],
    supportsOptions: ['colourScale'],
    supportsComparison: false,
    supportsDrilldown: false,
    libraryFree: false,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    for (const key of ['row', 'column'] as const) {
      if (!spec.encoding[key]) {
        problems.push({
          code: 'MISSING_ENCODING',
          message: `A heatmap needs \`encoding.${key}\`.`,
        });
      }
    }
    if (!spec.encoding.value && !spec.encoding.y?.length) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A heatmap needs a `value`.',
      });
    }
    return problems;
  },
  Component: CohortHeatmap,
};
export default renderer;
