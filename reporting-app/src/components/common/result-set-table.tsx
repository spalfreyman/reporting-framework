import { useIntl } from 'react-intl';
import DataTable from '@commercetools-uikit/data-table';
import type { ColumnMeta } from '../../shared/schema/query';
import { formatCell, labelForColumn } from './format-metric';
import { resolveDimensionCell } from '../../hooks/use-dimension-labels';
import type { TableLabelContext } from '../../hooks/use-dimension-labels';
import type { Cell, Row } from '../../types/reporting';

type Props = {
  columns: ColumnMeta[];
  rows: Row[];
  maxRows?: number;
  /**
   * When present, dimension cells are resolved to localized names and, where the entity has a
   * Merchant Center page, rendered as a link that opens it in a new tab. The `rows` passed
   * alongside must be the RAW rows (canonical keys), not pre-labelled ones, so the resolver
   * can recover the entity id. When absent, cells render as plain formatted text.
   */
  labelContext?: TableLabelContext;
};

/**
 * The tabular view of a tile's underlying data.
 *
 * This is every chart's accessibility fallback, not an afterthought: ECharts renders to
 * canvas, which assistive technology cannot read no matter what alt text is attached. A
 * real table with real headers is the substantive answer, so every tile exposes one.
 *
 * Dimension cells become clickable deep links to their Merchant Center entity page when a
 * `labelContext` is supplied — the canonical key stays in the data, only the display links.
 */
const ResultSetTable = ({ columns, rows, maxRows = 200, labelContext }: Props) => {
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
        const value = (row as Record<string, Cell>)[column.key];

        if (
          labelContext &&
          meta.role === 'dimension' &&
          labelContext.ctx.valueSourceByDimension[meta.id]
        ) {
          const { label, href } = resolveDimensionCell(
            labelContext.ctx,
            labelContext.projectKey,
            meta.id,
            value
          );
          if (href) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                {label}
              </a>
            );
          }
          return label;
        }

        return formatCell(intl, meta, value);
      }}
    />
  );
};
ResultSetTable.displayName = 'ResultSetTable';

export default ResultSetTable;
