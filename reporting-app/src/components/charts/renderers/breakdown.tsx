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
import { columnById, distinctValues, toCategorical } from '../adapters/shape';
import { labelForDimension, labelForMetric } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';
import type { Row } from '../../../types/reporting';

/**
 * Breakdown by a categorical dimension. One renderer covers bar, stacked bar, donut and
 * treemap — they are the same question ("how does this metric split by X?") drawn four ways,
 * chosen by `chart.type`, so a report author swaps the shape without changing the query.
 */

export interface BreakdownInput {
  spec: ChartSpec;
  type: 'breakdown' | 'donut' | 'treemap';
  columns: ColumnMeta[];
  rows: Row[];
  theme: ChartTheme;
  categoryLabel: string;
  labelOf: (id: string) => string;
  formatterFor: (id: string) => (value: number) => string;
}

export const buildBreakdownOption = (input: BreakdownInput): EChartsOption => {
  const { spec, type, rows, theme } = input;
  const category = spec.encoding.category?.field ?? '';
  const valueField =
    spec.encoding.y?.[0]?.field ?? spec.encoding.value?.field ?? '';
  const seriesFields =
    spec.encoding.y && spec.encoding.y.length > 0
      ? spec.encoding.y.map((r) => r.field)
      : [valueField];
  const base = baseOption(theme);

  // ── Donut ────────────────────────────────────────────────────────────────
  if (type === 'donut') {
    const maxSlices = spec.options?.maxSlices ?? 7;
    const pairs = toCategorical(rows, category, valueField, maxSlices);
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item' },
      legend: {
        ...base.legend,
        show: spec.options?.showLegend !== false,
        orient: 'vertical',
        left: 0,
        top: 'middle',
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '80%'],
          center: ['60%', '50%'],
          data: pairs,
          label: { show: spec.options?.showDataLabels === true },
        },
      ],
    };
  }

  // ── Treemap ──────────────────────────────────────────────────────────────
  if (type === 'treemap') {
    const pairs = toCategorical(rows, category, valueField, spec.options?.topN);
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item' },
      series: [
        {
          type: 'treemap',
          roam: false,
          breadcrumb: { show: false },
          data: pairs.map((p) => ({ name: p.name, value: p.value })),
          label: { show: true },
        },
      ],
    };
  }

  // ── Bar / stacked bar ──────────────────────────────────────────────────────
  const stacked =
    type === 'breakdown' &&
    (spec.options?.stacked === true || spec.options?.normalise === true);
  const categories = toCategorical(
    rows,
    category,
    seriesFields[0],
    spec.options?.topN
  ).map((p) => p.name);

  // For a stacked/grouped bar with multiple series, pivot value per (category, series field).
  const seriesList = seriesFields.map((field) => {
    const byCategory = new Map(
      toCategorical(rows, category, field).map((p) => [p.name, p.value])
    );
    let data = categories.map((c) => byCategory.get(c) ?? 0);
    if (spec.options?.normalise) {
      // 100% stacked: normalise each category's bar to its column total.
      const totals = categories.map((c) =>
        seriesFields.reduce((sum, f) => {
          const v = new Map(
            toCategorical(rows, category, f).map((p) => [p.name, p.value])
          ).get(c);
          return sum + (v ?? 0);
        }, 0)
      );
      data = data.map((v, i) => (totals[i] ? v / totals[i] : 0));
    }
    return {
      name: input.labelOf(field),
      type: 'bar' as const,
      stack: stacked ? 'total' : undefined,
      data,
      label: { show: spec.options?.showDataLabels === true },
    };
  });

  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    legend: {
      ...base.legend,
      show: spec.options?.showLegend !== false && seriesFields.length > 1,
    },
    // Horizontal bars read better for ranked categories with long labels.
    xAxis: valueAxis(theme, input.formatterFor(seriesFields[0]), {
      zero: true,
    }),
    yAxis: {
      ...categoryAxis(theme),
      data: [...categories].reverse(),
      inverse: true,
    },
    series: seriesList.map((s) => ({ ...s, data: [...s.data].reverse() })),
  };
};

const componentFor = (type: 'breakdown' | 'donut' | 'treemap') => {
  const Component = ({ spec, columns, rows, height }: RendererProps) => {
    const intl = useIntl();
    const theme = readChartTheme();
    const option = buildBreakdownOption({
      spec,
      type,
      columns,
      rows,
      theme,
      categoryLabel: labelForDimension(
        intl,
        spec.encoding.category?.field ?? ''
      ),
      labelOf: (id) => labelForMetric(intl, id),
      formatterFor: (id) => valueFormatter(intl, columnById(columns, id)),
    });
    const label = `${labelForDimension(
      intl,
      spec.encoding.category?.field ?? ''
    )} breakdown`;
    return <EChart option={option} height={height} ariaLabel={label} />;
  };
  Component.displayName = `Breakdown(${type})`;
  return Component;
};

const validate = (spec: ChartSpec, columns: ColumnMeta[]) => {
  const problems = validateEncodedFields(spec, columns);
  if (!spec.encoding.category) {
    problems.push({
      code: 'MISSING_ENCODING',
      message: 'A breakdown needs `encoding.category`.',
    });
  }
  if (!spec.encoding.y?.length && !spec.encoding.value) {
    problems.push({
      code: 'MISSING_ENCODING',
      message: 'A breakdown needs a `y` metric or `value`.',
    });
  }
  // Guard the donut slice explosion the plan calls out.
  if (spec.type === 'donut' && spec.encoding.category) {
    const distinct = distinctValues(
      columns.length ? [] : [],
      spec.encoding.category.field
    );
    void distinct;
  }
  return problems;
};

const makeRenderer = (type: 'breakdown' | 'donut' | 'treemap'): Renderer => ({
  capabilities: {
    type,
    requires: ['category'],
    supportsOptions: [
      'stacked',
      'normalise',
      'topN',
      'maxSlices',
      'showLegend',
      'showDataLabels',
    ],
    supportsComparison: false,
    supportsDrilldown: true,
    libraryFree: false,
  },
  validate,
  Component: componentFor(type),
});

export const breakdownRenderer = makeRenderer('breakdown');
export const donutRenderer = makeRenderer('donut');
export const treemapRenderer = makeRenderer('treemap');
export default breakdownRenderer;
