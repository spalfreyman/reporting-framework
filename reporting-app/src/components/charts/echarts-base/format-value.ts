import type { IntlShape } from 'react-intl';
import type { ColumnMeta } from '../../../shared/schema/query';
import { formatCell } from '../../common/format-metric';

/**
 * Axis and tooltip formatting.
 *
 * Charts must never render raw minor units. This routes chart values through the same
 * `formatCell` the tables use, so a value reads identically whether it is on an axis, in a
 * tooltip, or in the "view as table" fallback.
 */
export const valueFormatter =
  (intl: IntlShape, column: ColumnMeta | undefined) =>
  (value: number): string =>
    column ? formatCell(intl, column, value) : intl.formatNumber(value);
