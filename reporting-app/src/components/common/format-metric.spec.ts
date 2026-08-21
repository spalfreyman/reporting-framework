import { createIntl, createIntlCache } from 'react-intl';
import {
  EMPTY,
  computeDelta,
  formatCell,
  formatDelta,
  labelForMetric,
} from './format-metric';
import { dimensionMessages, metricMessages } from '../../i18n/messages/shared';
import type { ColumnMeta } from '../../shared/schema/query';

/**
 * One formatter serves charts, tables, tooltips and KPI tiles. If it is wrong, it is wrong
 * everywhere at once — and the failures are the quiet kind: minor units rendered as whole
 * currency, or a worsening metric coloured green.
 */

/**
 * Build the message table from the declared defaults rather than passing `{}`. An empty
 * table makes react-intl warn on every lookup, and this preset fails the suite on console
 * output — but more importantly, testing against the real labels is what catches a metric
 * whose message was never declared.
 */
const messages = Object.fromEntries(
  [...Object.values(metricMessages), ...Object.values(dimensionMessages)].map(
    (message) => [message.id, message.defaultMessage]
  )
);

const cache = createIntlCache();
const intl = createIntl({ locale: 'en-GB', messages }, cache);

const money = (currencyCode?: string): ColumnMeta => ({
  id: 'revenue.net@orderdate',
  role: 'metric',
  valueType: 'money',
  ...(currencyCode
    ? { currencyCode, fractionDigits: 2 }
    : { fractionDigits: 2 }),
  exactness: 'exact',
  nullMeaning: 'zero',
});

const count: ColumnMeta = {
  id: 'orders.count@orderdate',
  role: 'metric',
  valueType: 'count',
  exactness: 'exact',
  nullMeaning: 'zero',
};

const percent: ColumnMeta = {
  id: 'conversion.rate',
  role: 'metric',
  valueType: 'percent',
  exactness: 'exact',
  nullMeaning: 'unknown',
};

const date: ColumnMeta = {
  id: 'date',
  role: 'time',
  valueType: 'time',
  exactness: 'exact',
  nullMeaning: 'unknown',
};

describe('formatCell', () => {
  it('renders money from minor units, with its currency', () => {
    // 2733952 minor units is £27,339.52 — not 2,733,952.
    expect(formatCell(intl, money('GBP'), 2733952)).toBe('£27,339.52');
    expect(formatCell(intl, money('EUR'), 100)).toBe('€1.00');
  });

  it('never implies a currency it was not given', () => {
    // A money column without a currency happens when several are present; showing one
    // arbitrarily would be a lie, so it falls back to a bare number.
    const formatted = formatCell(intl, money(), 2733952);
    expect(formatted).toBe('27,339.52');
    expect(formatted).not.toContain('£');
    expect(formatted).not.toContain('€');
  });

  it('renders a ratio as a percentage', () => {
    expect(formatCell(intl, percent, 0.0243)).toBe('2.43%');
  });

  it('renders counts without decimals', () => {
    expect(formatCell(intl, count, 3565)).toBe('3,565');
  });

  it('renders an absent value as a dash, never as zero', () => {
    // "0 orders" and "we do not know" are different facts.
    expect(formatCell(intl, count, null)).toBe(EMPTY);
    expect(formatCell(intl, money('GBP'), null)).toBe(EMPTY);
  });

  it('renders a day bucket in UTC, so the label matches the bucket', () => {
    // Formatting in the browser's zone would shift the displayed day for anyone west of UTC.
    expect(formatCell(intl, date, '2026-08-19')).toBe('19 Aug 2026');
  });
});

describe('computeDelta', () => {
  it('treats a rise in a good metric as positive', () => {
    const delta = computeDelta('revenue.net@orderdate', 120, 100);
    expect(delta.relative).toBeCloseTo(0.2);
    expect(delta.tone).toBe('positive');
  });

  it('treats a rise in a BAD metric as negative', () => {
    // The bug this prevents: a climbing return rate rendering green because it went up.
    const delta = computeDelta('return.rate', 0.12, 0.08);
    expect(delta.absolute).toBeCloseTo(0.04);
    expect(delta.tone).toBe('negative');
  });

  it('treats a fall in a bad metric as positive', () => {
    expect(computeDelta('refund.rate', 0.03, 0.09).tone).toBe('positive');
  });

  it('is neutral when the metric has no declared direction', () => {
    expect(computeDelta('tax.collected@orderdate', 200, 100).tone).toBe(
      'neutral'
    );
  });

  it('is neutral on no change', () => {
    expect(computeDelta('revenue.net@orderdate', 100, 100).tone).toBe(
      'neutral'
    );
  });

  it('yields no relative change when the previous period was zero', () => {
    // Dividing by zero would render Infinity%, which is worse than showing nothing.
    const delta = computeDelta('revenue.net@orderdate', 100, 0);
    expect(delta.relative).toBeNull();
    expect(formatDelta(intl, delta)).toBe(EMPTY);
  });

  it('yields nothing comparable when either side is missing', () => {
    expect(
      computeDelta('revenue.net@orderdate', 100, null).relative
    ).toBeNull();
    expect(
      computeDelta('revenue.net@orderdate', null, 100).relative
    ).toBeNull();
  });
});

describe('formatDelta', () => {
  it('signs an increase explicitly', () => {
    expect(
      formatDelta(intl, computeDelta('revenue.net@orderdate', 120, 100))
    ).toBe('+20%');
  });

  it('shows a decrease with its own sign', () => {
    expect(
      formatDelta(intl, computeDelta('revenue.net@orderdate', 80, 100))
    ).toBe('-20%');
  });
});

describe('labelForMetric', () => {
  it('resolves a registry metric to its translated label', () => {
    expect(labelForMetric(intl, 'revenue.net@orderdate')).toBe('Net revenue');
    expect(labelForMetric(intl, 'aov@orderdate')).toBe('Average order value');
  });

  it('distinguishes order-date from cash-date revenue in the UI', () => {
    // These are deliberately different metrics; if they rendered identically the whole
    // point of separating them would be lost on the reader.
    expect(labelForMetric(intl, 'revenue.net@orderdate')).not.toBe(
      labelForMetric(intl, 'revenue.net@cashdate')
    );
  });

  it('falls back to the id for an unknown metric rather than rendering blank', () => {
    expect(labelForMetric(intl, 'not.a.metric')).toBe('not.a.metric');
  });
});
