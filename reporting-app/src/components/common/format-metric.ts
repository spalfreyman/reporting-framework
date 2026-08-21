import type { IntlShape } from 'react-intl';
import type { ColumnMeta } from '../../shared/schema/query';
import { getMetric } from '../../shared/semantic/metrics';
import { getDimension } from '../../shared/semantic/dimensions';
import { metricMessages, dimensionMessages } from '../../i18n/messages/shared';
import type { Cell } from '../../types/reporting';

/**
 * One formatter for every surface.
 *
 * Charts, tables, KPI tiles and tooltips all go through this, which is what stops an axis
 * rendering raw minor units while the table beside it shows currency. It also means a money
 * value is never displayed without its currency.
 */

export const labelForMetric = (intl: IntlShape, metricId: string): string => {
  const def = getMetric(metricId);
  const message = def
    ? metricMessages[def.labelKey as keyof typeof metricMessages]
    : undefined;
  return message ? intl.formatMessage(message) : metricId;
};

export const labelForDimension = (
  intl: IntlShape,
  dimensionId: string
): string => {
  const def = getDimension(dimensionId);
  const message = def
    ? dimensionMessages[def.labelKey as keyof typeof dimensionMessages]
    : undefined;
  return message ? intl.formatMessage(message) : dimensionId;
};

export const labelForColumn = (intl: IntlShape, column: ColumnMeta): string =>
  column.role === 'metric'
    ? labelForMetric(intl, column.id)
    : column.role === 'time'
    ? labelForDimension(intl, 'date')
    : labelForDimension(intl, column.id);

/** A dash, not "0" — an absent value is not a zero value. */
export const EMPTY = '—';

export const formatCell = (
  intl: IntlShape,
  column: ColumnMeta,
  value: Cell
): string => {
  if (value === null || value === undefined) return EMPTY;

  if (column.role !== 'metric') {
    if (column.role === 'time' && typeof value === 'string') {
      // Bucket starts are plain YYYY-MM-DD; render in the user's locale, in UTC so the
      // displayed day matches the bucket rather than shifting by the browser's offset.
      const parsed = Date.parse(`${value}T00:00:00Z`);
      if (!Number.isNaN(parsed)) {
        return intl.formatDate(parsed, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
      }
    }
    return String(value);
  }

  if (typeof value !== 'number') return String(value);

  const def = getMetric(column.id);
  const style = def?.format.style ?? 'decimal';

  switch (style) {
    case 'money': {
      const fractionDigits = column.fractionDigits ?? 2;
      const amount = value / 10 ** fractionDigits;
      // Without a currency we must not imply one, so fall back to a plain decimal.
      return column.currencyCode
        ? intl.formatNumber(amount, {
            style: 'currency',
            currency: column.currencyCode,
            maximumFractionDigits: fractionDigits,
          })
        : intl.formatNumber(amount, { maximumFractionDigits: fractionDigits });
    }
    case 'percent':
      return intl.formatNumber(value, {
        style: 'percent',
        minimumFractionDigits: def?.format.precision ?? 2,
        maximumFractionDigits: def?.format.precision ?? 2,
      });
    case 'integer':
      return intl.formatNumber(value, { maximumFractionDigits: 0 });
    case 'duration': {
      const hours = value / 3600;
      return hours >= 1
        ? intl.formatNumber(hours, { maximumFractionDigits: 1 }) + 'h'
        : intl.formatNumber(value / 60, { maximumFractionDigits: 0 }) + 'm';
    }
    default:
      return intl.formatNumber(value, {
        maximumFractionDigits: def?.format.precision ?? 2,
      });
  }
};

export type Delta = {
  absolute: number | null;
  relative: number | null;
  /** Whether the movement is GOOD, which is not the same as whether it is up. */
  tone: 'positive' | 'negative' | 'neutral';
};

/**
 * A delta, with direction interpreted against the metric's own goodness.
 *
 * A rising return rate is bad and must not render green. This is why `higherIsBetter` is a
 * registry property rather than a chart option.
 */
export const computeDelta = (
  metricId: string,
  current: Cell,
  previous: Cell
): Delta => {
  if (typeof current !== 'number' || typeof previous !== 'number') {
    return { absolute: null, relative: null, tone: 'neutral' };
  }
  const absolute = current - previous;
  const relative = previous === 0 ? null : absolute / Math.abs(previous);

  const higherIsBetter = getMetric(metricId)?.higherIsBetter;
  if (absolute === 0 || higherIsBetter === undefined) {
    return { absolute, relative, tone: 'neutral' };
  }
  const improved = higherIsBetter ? absolute > 0 : absolute < 0;
  return { absolute, relative, tone: improved ? 'positive' : 'negative' };
};

export const formatDelta = (intl: IntlShape, delta: Delta): string => {
  if (delta.relative === null) return EMPTY;
  const sign = delta.relative > 0 ? '+' : '';
  return `${sign}${intl.formatNumber(delta.relative, {
    style: 'percent',
    maximumFractionDigits: 1,
  })}`;
};
