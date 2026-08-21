import { useIntl } from 'react-intl';
import type { EChartsOption } from '../echarts-base/register-echarts';
import EChart from '../echarts-base/echart';
import {
  baseOption,
  categoryAxis,
  valueAxis,
} from '../echarts-base/base-option';
import { readChartTheme, type ChartTheme } from '../echarts-base/theme';
import { valueFormatter } from '../echarts-base/format-value';
import { columnById, toCategorical } from '../adapters/shape';
import { labelForDimension } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';
import type { Row } from '../../../types/reporting';

/**
 * A distribution over pre-binned buckets — price bands, basket-size ranges.
 *
 * The binning is done upstream (a `ranges` facet, or a bucket dimension in the query), so
 * this just draws a bar per bucket in the buckets' own order. It does NOT re-bin, because
 * the buckets carry meaning the chart shouldn't second-guess.
 */

export interface HistogramInput {
  spec: ChartSpec;
  columns: ColumnMeta[];
  rows: Row[];
  theme: ChartTheme;
  formatterFor: (id: string) => (value: number) => string;
}

export const buildHistogramOption = (input: HistogramInput): EChartsOption => {
  const { spec, rows, theme } = input;
  const bucketField =
    spec.encoding.category?.field ?? spec.encoding.x?.field ?? '';
  const valueField =
    spec.encoding.value?.field ?? spec.encoding.y?.[0]?.field ?? '';
  const pairs = toCategorical(rows, bucketField, valueField);
  // Keep the buckets in row order, not sorted by value — a distribution is ordinal.
  const ordered = rows
    .map((r) => {
      const name = r[bucketField];
      const found = pairs.find((p) => p.name === String(name));
      return name !== null && name !== undefined && found ? found : null;
    })
    .filter((p): p is { name: string; value: number } => p !== null);

  return {
    ...baseOption(theme),
    tooltip: {
      ...baseOption(theme).tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    xAxis: { ...categoryAxis(theme), data: ordered.map((p) => p.name) },
    yAxis: valueAxis(theme, input.formatterFor(valueField), { zero: true }),
    series: [
      { type: 'bar', barCategoryGap: '8%', data: ordered.map((p) => p.value) },
    ],
  };
};

const Histogram = ({ spec, columns, rows, height }: RendererProps) => {
  const intl = useIntl();
  const option = buildHistogramOption({
    spec,
    columns,
    rows,
    theme: readChartTheme(),
    formatterFor: (id) => valueFormatter(intl, columnById(columns, id)),
  });
  const label =
    labelForDimension(intl, spec.encoding.category?.field ?? '') +
    ' distribution';
  return <EChart option={option} height={height} ariaLabel={label} />;
};
Histogram.displayName = 'Histogram';

const renderer: Renderer = {
  capabilities: {
    type: 'histogram',
    requires: [],
    supportsOptions: ['yZero'],
    supportsComparison: false,
    supportsDrilldown: false,
    libraryFree: false,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) =>
    validateEncodedFields(spec, columns),
  Component: Histogram,
};
export default renderer;
