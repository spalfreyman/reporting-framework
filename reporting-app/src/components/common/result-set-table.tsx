import { useIntl } from 'react-intl';
import DataTable from '@commercetools-uikit/data-table';
import type { ColumnMeta } from '../../shared/schema/query';
import { formatCell, labelForColumn } from './format-metric';
import type { Cell, Row } from '../../types/reporting';

type Props = {
  columns: ColumnMeta[];
  rows: Row[];
  maxRows?: number;
};

/**
 * The tabular view of a tile's underlying data.
 *
 * This is every chart's accessibility fallback, not an afterthought: ECharts renders to
 * canvas, which assistive technology cannot read no matter what alt text is attached. A
 * real table with real headers is the substantive answer, so every tile exposes one.
 */
const ResultSetTable = ({ columns, rows, maxRows = 200 }: Props) => {
  const intl = useIntl();

  const tableColumns = columns.map((column) => ({
    key: column.id,
    label: labelForColumn(intl, column),
    align: column.role === 'metric' ? ('right' as const) : ('left' as const),
  }));

  const visible = rows
    .slice(0, maxRows)
    .map((row, index) => ({ id: String(index), ...row }));

  return (
    <DataTable
      columns={tableColumns}
      rows={visible}
      maxHeight="30rem"
      itemRenderer={(row, column) => {
        const meta = columns.find((c) => c.id === column.key);
        if (!meta) return null;
        return formatCell(
          intl,
          meta,
          (row as Record<string, Cell>)[column.key]
        );
      }}
    />
  );
};
ResultSetTable.displayName = 'ResultSetTable';

export default ResultSetTable;
