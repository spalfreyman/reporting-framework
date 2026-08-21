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
import {
  asNumber,
  columnById,
  timeColumn,
  toTimeSeries,
} from '../adapters/shape';
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
 * Revenue/orders/sessions over time. Multi-series, optional dual axis, and the comparison
 * period drawn as a dashed "ghost" line so it reads as context rather than a peer series.
 */

export interface TimeSeriesInput {
  spec: ChartSpec;
  columns: ColumnMeta[];
  rows: Row[];
  comparison?: { rows: Row[] } | undefined;
  theme: ChartTheme;
  labelOf: (id: string) => string;
  formatterFor: (id: string) => (value: number) => string;
}

/**
 * Pure spec → ECharts option. No React, no canvas — this is the whole chart, and it is what
 * the tests exercise.
 */
export const buildTimeSeriesOption = (
  input: TimeSeriesInput
): EChartsOption => {
  const { spec, columns, rows, comparison, theme } = input;
  const time = timeColumn(columns);
  const timeField = spec.encoding.x?.field ?? time?.id ?? 'date';
  const seriesRefs = spec.encoding.y ?? [];

  const dual = spec.options?.dualAxis === true;
  const rightFields = new Set(
    seriesRefs.filter((r) => r.axis === 'right').map((r) => r.field)
  );

  // Distinct x values across primary rows, ascending.
  const xValues = [
    ...new Set(
      rows.map((r) => String(r[timeField])).filter((v) => v !== 'undefined')
    ),
  ].sort((a, b) => a.localeCompare(b));

  const seriesFor = (field: string, rowsForSeries: Row[], ghost: boolean) => {
    const points = new Map(toTimeSeries(rowsForSeries, timeField, field));
    const ref = seriesRefs.find((r) => r.field === field);
    const onRight = dual && rightFields.has(field);
    const mark = ref?.mark ?? 'line';
    return {
      name: ghost ? `${input.labelOf(field)} (prev)` : input.labelOf(field),
      type: mark === 'bar' ? ('bar' as const) : ('line' as const),
      ...(mark === 'area' ? { areaStyle: {} } : {}),
      yAxisIndex: onRight ? 1 : 0,
      showSymbol: false,
      smooth: false,
      // Align every series to the shared x axis; a gap stays a gap (null), not a zero.
      data: xValues.map((x) => points.get(x) ?? null),
      ...(ghost
        ? {
            lineStyle: { type: 'dashed' as const, opacity: 0.6 },
            itemStyle: { opacity: 0.6 },
          }
        : {}),
    };
  };

  const primarySeries = seriesRefs.map((ref) =>
    seriesFor(ref.field, rows, false)
  );
  const ghostSeries =
    spec.options?.showComparisonGhost && comparison
      ? seriesRefs.map((ref) => seriesFor(ref.field, comparison.rows, true))
      : [];

  const leftField = seriesRefs.find((r) => r.axis !== 'right')?.field;
  const rightField = seriesRefs.find((r) => r.axis === 'right')?.field;

  return {
    ...baseOption(theme),
    tooltip: { ...baseOption(theme).tooltip, trigger: 'axis' },
    legend: {
      ...baseOption(theme).legend,
      show:
        spec.options?.showLegend !== false &&
        (seriesRefs.length > 1 || ghostSeries.length > 0),
    },
    xAxis: {
      ...categoryAxis(theme),
      data: xValues,
      boundaryGap: primarySeries.some((s) => s.type === 'bar'),
    },
    yAxis: dual
      ? [
          valueAxis(
            theme,
            leftField ? input.formatterFor(leftField) : undefined,
            {
              zero: spec.options?.yZero,
            }
          ),
          valueAxis(
            theme,
            rightField ? input.formatterFor(rightField) : undefined,
            {
              zero: spec.options?.yZero,
            }
          ),
        ]
      : valueAxis(
          theme,
          leftField ? input.formatterFor(leftField) : undefined,
          {
            zero: spec.options?.yZero,
          }
        ),
    // Brush-to-zoom once the series gets long enough to be fiddly.
    ...(xValues.length > 90
      ? {
          dataZoom: [
            { type: 'inside' },
            { type: 'slider', height: 16, bottom: 0 },
          ],
        }
      : {}),
    series: [...primarySeries, ...ghostSeries],
  };
};

const TimeSeries = ({
  spec,
  columns,
  rows,
  comparison,
  height,
}: RendererProps) => {
  const intl = useIntl();
  const theme = readChartTheme();
  const option = buildTimeSeriesOption({
    spec,
    columns,
    rows,
    comparison,
    theme,
    labelOf: (id) => labelForMetric(intl, id),
    formatterFor: (id) => valueFormatter(intl, columnById(columns, id)),
  });
  const label = (spec.encoding.y ?? [])
    .map((r) => labelForMetric(intl, r.field))
    .join(', ');
  return (
    <EChart
      option={option}
      height={height}
      ariaLabel={label || 'time series'}
    />
  );
};
TimeSeries.displayName = 'TimeSeries';

const renderer: Renderer = {
  capabilities: {
    type: 'timeseries',
    requires: ['y'],
    supportsOptions: ['dualAxis', 'showLegend', 'showComparisonGhost', 'yZero'],
    maxSeries: 6,
    supportsComparison: true,
    supportsDrilldown: false,
    libraryFree: false,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    if (!spec.encoding.y || spec.encoding.y.length === 0) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A time series needs at least one `y` metric.',
      });
    }
    if (!timeColumn(columns) && !spec.encoding.x) {
      problems.push({
        code: 'NO_TIME',
        message: 'A time series needs a time column or an explicit `x`.',
      });
    }
    return problems;
  },
  Component: TimeSeries,
};
export default renderer;
export const __test = { asNumber };
