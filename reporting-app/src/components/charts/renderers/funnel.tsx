import { useIntl } from 'react-intl';
import type { EChartsOption } from '../echarts-base/register-echarts';
import EChart from '../echarts-base/echart';
import { baseOption } from '../echarts-base/base-option';
import { readChartTheme, type ChartTheme } from '../echarts-base/theme';
import { asNumber } from '../adapters/shape';
import { labelForMetric } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';
import type { Cell } from '../../../types/reporting';

/**
 * A conversion funnel: sessions → PDP → add-to-cart → checkout → order.
 *
 * Steps are named metric fields taken from the tile's totals, so the funnel is a single
 * cross-metric snapshot, not a per-row series. Each step shows both its own share of the top
 * and the step-to-step conversion, because "42% of the previous step" is the number a UX
 * analyst actually acts on.
 */

export interface FunnelInput {
  spec: ChartSpec;
  totals: Record<string, Cell>;
  theme: ChartTheme;
  labelOf: (id: string) => string;
}

export const buildFunnelOption = (input: FunnelInput): EChartsOption => {
  const { spec, totals, theme } = input;
  const steps = spec.encoding.steps ?? [];

  const data = steps
    .map((field) => ({ field, value: asNumber(totals[field]) }))
    .filter((s): s is { field: string; value: number } => s.value !== null)
    .map((s) => ({ name: input.labelOf(s.field), value: s.value }));

  const top = data[0]?.value ?? 0;

  return {
    ...baseOption(theme),
    tooltip: {
      ...baseOption(theme).tooltip,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; dataIndex: number };
        const prev = data[p.dataIndex - 1]?.value;
        const ofTop = top ? ((p.value / top) * 100).toFixed(1) : '0';
        const ofPrev = prev ? ((p.value / prev) * 100).toFixed(1) : null;
        return [
          `<strong>${p.name}</strong>`,
          `${p.value.toLocaleString()}`,
          `${ofTop}% of top`,
          ofPrev !== null ? `${ofPrev}% of previous step` : null,
        ]
          .filter(Boolean)
          .join('<br/>');
      },
    },
    series: [
      {
        type: 'funnel',
        sort: 'descending',
        gap: 2,
        top: 24,
        bottom: 8,
        minSize: '14%',
        label: { show: true, position: 'inside', formatter: '{b}' },
        data,
      },
    ],
  };
};

const Funnel = ({ spec, totals, height }: RendererProps) => {
  const intl = useIntl();
  const option = buildFunnelOption({
    spec,
    totals,
    theme: readChartTheme(),
    labelOf: (id) => labelForMetric(intl, id),
  });
  return (
    <EChart option={option} height={height} ariaLabel="conversion funnel" />
  );
};
Funnel.displayName = 'Funnel';

const renderer: Renderer = {
  capabilities: {
    type: 'funnel',
    requires: ['steps'],
    supportsOptions: [],
    supportsComparison: false,
    supportsDrilldown: false,
    libraryFree: false,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    if (!spec.encoding.steps || spec.encoding.steps.length < 2) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A funnel needs at least two `steps`.',
      });
    }
    return problems;
  },
  Component: Funnel,
};
export default renderer;
