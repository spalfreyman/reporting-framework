import ResultSetTable from '../../common/result-set-table';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';

/**
 * The paginated detail table. UI Kit's DataTable, no charting library.
 *
 * Column order follows the spec when one is given, so a report author controls it; otherwise
 * it falls back to the result set's own order.
 */
const TableRenderer = ({ spec, columns, rows }: RendererProps) => {
  const requested = spec.encoding.columns?.map((c) => c.field);
  const ordered = requested
    ? requested
        .map((field) => columns.find((c) => c.id === field))
        .filter((c): c is ColumnMeta => Boolean(c))
    : columns;

  return (
    <ResultSetTable
      columns={ordered}
      rows={rows}
      maxRows={spec.options?.pageSize ?? 50}
    />
  );
};
TableRenderer.displayName = 'TableRenderer';

const renderer: Renderer = {
  capabilities: {
    type: 'table',
    requires: [],
    supportsOptions: ['pageSize', 'totalsRow'],
    supportsComparison: false,
    supportsDrilldown: true,
    libraryFree: true,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) =>
    validateEncodedFields(spec, columns),
  Component: TableRenderer,
};

export default renderer;
