import { useIntl } from 'react-intl';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import DeltaBadge from '../../common/delta-badge';
import { EMPTY, formatCell, labelForMetric } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';

/**
 * A headline figure with its change against the comparison period.
 *
 * No charting library: this is text and a UI Kit stamp. It is also the tile that appears
 * most often, which is why keeping it library-free matters for first paint.
 */
const KpiStat = ({ spec, columns, totals, comparison }: RendererProps) => {
  const intl = useIntl();

  const field = spec.encoding.value?.field;
  const column = columns.find((c) => c.id === field);

  if (!field || !column) {
    return (
      <Text.Headline as="h3" tone="secondary">
        {EMPTY}
      </Text.Headline>
    );
  }

  const current = totals[field] ?? null;
  const previousField = spec.encoding.compare?.field ?? field;
  const previous = comparison?.totals[previousField] ?? null;

  return (
    <Spacings.Stack scale="xs">
      <Text.Detail tone="secondary">{labelForMetric(intl, field)}</Text.Detail>
      <Text.Headline as="h2">{formatCell(intl, column, current)}</Text.Headline>
      {spec.encoding.compare && previous !== null ? (
        <Spacings.Inline scale="xs" alignItems="center">
          <DeltaBadge metricId={field} current={current} previous={previous} />
          {comparison ? (
            <Text.Detail tone="secondary">
              {intl.formatMessage(
                {
                  id: 'Reporting.common.comparedTo',
                  defaultMessage: 'vs {from} – {to}',
                },
                { from: comparison.range.from, to: comparison.range.to }
              )}
            </Text.Detail>
          ) : null}
        </Spacings.Inline>
      ) : null}
    </Spacings.Stack>
  );
};
KpiStat.displayName = 'KpiStat';

const renderer: Renderer = {
  capabilities: {
    type: 'kpi',
    requires: ['value'],
    supportsOptions: ['goodDirection'],
    supportsComparison: true,
    supportsDrilldown: false,
    libraryFree: true,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    if (!spec.encoding.value) {
      problems.push({
        code: 'MISSING_ENCODING',
        message:
          'A KPI tile needs `encoding.value` to know which metric to show.',
      });
    }
    return problems;
  },
  Component: KpiStat,
};

export default renderer;
