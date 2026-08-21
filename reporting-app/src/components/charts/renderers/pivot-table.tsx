import { useIntl } from 'react-intl';
import DataTable from '@commercetools-uikit/data-table';
import Text from '@commercetools-uikit/text';
import Spacings from '@commercetools-uikit/spacings';
import { pivot, isAdditiveColumn } from '../adapters/pivot';
import { columnById } from '../adapters/shape';
import {
  formatCell,
  labelForDimension,
  labelForMetric,
  EMPTY,
} from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';

/**
 * A pivot table: one measure across rows × columns, with row/column subtotals and a grand
 * total. Library-free — it is UI Kit's DataTable — so it costs no charting bytes.
 *
 * Subtotals are shown only for additive measures; a ratio is left blank rather than summed
 * into a meaningless figure.
 */
const PivotTable = ({ spec, columns, rows }: RendererProps) => {
  const intl = useIntl();
  const rowField = spec.encoding.row?.field ?? '';
  const colField = spec.encoding.column?.field ?? '';
  const valueField =
    spec.encoding.values?.[0]?.field ?? spec.encoding.value?.field ?? '';
  const valueColumn = columnById(columns, valueField);
  const additive = isAdditiveColumn(valueColumn);
  const totalsRow = spec.options?.totalsRow !== false;

  const p = pivot(rows, rowField, colField, valueField, additive);
  const fmt = (v: number | null) =>
    v === null || !valueColumn ? EMPTY : formatCell(intl, valueColumn, v);

  const tableColumns = [
    { key: '__row', label: labelForDimension(intl, rowField) },
    ...p.colKeys.map((ck) => ({ key: ck, label: ck, align: 'right' as const })),
    ...(additive
      ? [
          {
            key: '__total',
            label: intl.formatMessage({
              id: 'Reporting.pivot.total',
              defaultMessage: 'Total',
            }),
            align: 'right' as const,
          },
        ]
      : []),
  ];

  const dataRows = p.rowKeys.map((rk) => ({
    id: rk,
    __row: rk,
    ...Object.fromEntries(p.colKeys.map((ck) => [ck, fmt(p.cell[rk][ck])])),
    __total: fmt(p.rowTotals[rk]),
  }));

  if (totalsRow && additive) {
    dataRows.push({
      id: '__grand',
      __row: intl.formatMessage({
        id: 'Reporting.pivot.total',
        defaultMessage: 'Total',
      }),
      ...Object.fromEntries(p.colKeys.map((ck) => [ck, fmt(p.colTotals[ck])])),
      __total: fmt(p.grandTotal),
    });
  }

  return (
    <Spacings.Stack scale="xs">
      <Text.Detail tone="secondary">
        {labelForMetric(intl, valueField)} · {labelForDimension(intl, rowField)}{' '}
        × {labelForDimension(intl, colField)}
      </Text.Detail>
      <DataTable
        columns={tableColumns}
        rows={dataRows}
        itemRenderer={(row, column) =>
          (row as Record<string, string>)[column.key]
        }
      />
    </Spacings.Stack>
  );
};
PivotTable.displayName = 'PivotTable';

const renderer: Renderer = {
  capabilities: {
    type: 'pivot',
    requires: ['row', 'column'],
    supportsOptions: ['totalsRow'],
    supportsComparison: false,
    supportsDrilldown: false,
    libraryFree: true,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    for (const key of ['row', 'column'] as const) {
      if (!spec.encoding[key]) {
        problems.push({
          code: 'MISSING_ENCODING',
          message: `A pivot needs \`encoding.${key}\`.`,
        });
      }
    }
    if (!spec.encoding.values?.length && !spec.encoding.value) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A pivot needs a `value`.',
      });
    }
    return problems;
  },
  Component: PivotTable,
};
export default renderer;
