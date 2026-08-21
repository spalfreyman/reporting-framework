import {
  decodeFilters,
  encodeFilters,
  toRequest,
  type FilterState,
} from './filters-codec';
import type { CatalogueEntry } from '../../types/reporting';

/**
 * Filter state lives in the URL so every view is shareable. These tests cover the two
 * properties that makes worth having: a link must round-trip exactly, and a hand-edited or
 * outdated link must degrade to the report's defaults rather than erroring.
 */

const report = {
  id: 'trading-dashboard',
  defaults: {
    datePreset: 'last28d',
    grain: 'day',
    comparison: { kind: 'previousPeriod', alignBy: 'weekday' },
  },
  allowedFilters: [
    { dimension: 'store', ops: ['in'], multi: true, valueSource: 'ct-stores' },
    { dimension: 'currency', ops: ['in'], multi: true, valueSource: 'dsp' },
  ],
} as unknown as CatalogueEntry;

describe('filters codec', () => {
  it('round-trips a full filter state through the URL', () => {
    const state: FilterState = {
      datePreset: 'last7d',
      grain: 'week',
      compare: 'previousYear',
      dimensions: {
        store: ['de-berlin-01', 'uk-manchester-01'],
        currency: ['EUR'],
      },
    };
    expect(
      decodeFilters(`?${encodeFilters(state).toString()}`, report)
    ).toEqual(state);
  });

  it('round-trips a custom range', () => {
    const state: FilterState = {
      datePreset: 'custom',
      from: '2026-01-01',
      to: '2026-02-01',
      grain: 'month',
      compare: 'none',
      dimensions: {},
    };
    expect(
      decodeFilters(`?${encodeFilters(state).toString()}`, report)
    ).toEqual(state);
  });

  it('stores a relative preset as its id, so a shared link stays relative', () => {
    // A link sent today should still mean "last 28 days" next week, not those exact dates.
    const params = encodeFilters({
      datePreset: 'last28d',
      grain: 'day',
      compare: 'previousPeriod',
      dimensions: {},
    });
    expect(params.get('preset')).toBe('last28d');
    expect(params.get('from')).toBeNull();
    expect(params.get('to')).toBeNull();
  });

  it('falls back to report defaults for an unknown preset rather than erroring', () => {
    const decoded = decodeFilters(
      '?preset=last-fortnight&grain=fortnightly',
      report
    );
    expect(decoded.datePreset).toBe('last28d');
    expect(decoded.grain).toBe('day');
  });

  it('ignores a filter the report does not declare', () => {
    // Otherwise a crafted URL could introduce a breakdown the report never offered.
    const decoded = decodeFilters('?d.store=a&d.secretDimension=b', report);
    expect(decoded.dimensions).toEqual({ store: ['a'] });
  });

  it('ignores a malformed custom range instead of sending it to the gateway', () => {
    const decoded = decodeFilters(
      '?preset=custom&from=01-01-2026&to=nonsense',
      report
    );
    expect(decoded.datePreset).toBe('custom');
    expect(decoded.from).toBeUndefined();
    expect(decoded.to).toBeUndefined();
  });

  it('survives an empty query string', () => {
    const decoded = decodeFilters('', report);
    expect(decoded).toEqual({
      datePreset: 'last28d',
      grain: 'day',
      compare: 'previousPeriod',
      dimensions: {},
    });
  });

  it('drops empty filter values rather than sending an empty allow-list', () => {
    // An empty `in` list means "match nothing", which is not what an empty control means.
    const decoded = decodeFilters('?d.store=', report);
    expect(decoded.dimensions.store).toBeUndefined();
  });

  it('builds a gateway request with dimension filters as `in` expressions', () => {
    const request = toRequest(
      {
        datePreset: 'last7d',
        grain: 'day',
        compare: 'previousPeriod',
        dimensions: { store: ['de-berlin-01'] },
      },
      'Europe/London',
      'en'
    );

    expect(request).toEqual({
      datePreset: 'last7d',
      grain: 'day',
      compare: 'previousPeriod',
      filters: [{ dimension: 'store', op: 'in', values: ['de-berlin-01'] }],
      timezone: 'Europe/London',
      locale: 'en',
    });
    // Notably absent: any `scope`. The gateway derives that from the verified session, and
    // would ignore it here anyway.
    expect('scope' in request).toBe(false);
  });

  it('sends an explicit range only for a custom preset', () => {
    expect(
      toRequest(
        {
          datePreset: 'custom',
          from: '2026-01-01',
          to: '2026-02-01',
          grain: 'day',
          compare: 'none',
          dimensions: {},
        },
        'UTC',
        'en'
      ).range
    ).toEqual({ from: '2026-01-01', to: '2026-02-01' });

    expect(
      toRequest(
        { datePreset: 'mtd', grain: 'day', compare: 'none', dimensions: {} },
        'UTC',
        'en'
      ).range
    ).toBeUndefined();
  });
});
