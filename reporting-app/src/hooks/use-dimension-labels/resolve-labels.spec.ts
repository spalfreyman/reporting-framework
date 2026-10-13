import {
  CT_VALUE_SOURCES,
  ctValueSourcesFromReport,
  isCtValueSource,
  NONE_SENTINEL,
  OTHER_SENTINEL,
  resolveDimensionValue,
  resolveDimensionHref,
  resolveDimensionCell,
  resolveRow,
  type DimensionLabelContext,
} from './resolve-labels';
import type { ColumnMeta } from '../../shared/schema/query';

/**
 * The resolver is the one place a canonical key becomes human text. If it picks the wrong
 * entry — or stops falling back to the raw value — every chart and table is wrong at once,
 * and silently. These tests pin the key / id / sentinel / fallback contract without a
 * network, Apollo, or the Merchant Center session.
 */

const sentinels = {
  noneByValueSource: { 'ct-categories': 'Uncategorised' },
  noneDefault: 'None',
  other: 'Other',
};

const ctx: DimensionLabelContext = {
  valueSourceByDimension: {
    product: 'ct-products',
    category: 'ct-categories',
    store: 'ct-stores',
    distributionChannel: 'ct-channels',
    // currency is a dsp source → deliberately absent, so it is never resolved.
  },
  maps: {
    'ct-products': {
      // Products are keyed by variant SKU → the product name.
      'SKU-123': 'Pallet Jack 2.5t',
    },
    'ct-categories': {
      // The rollup stores a category KEY when it has one...
      c1: 'Hand Trucks',
      Hubwagen: 'Pallet Trucks',
      // ...and otherwise the category ID (a bare UUID) as a fallback.
      '776ec960-83f3-45a3-8631-07c00ad9367e': 'Spare Parts',
    },
    'ct-stores': { 'berlin-flagship': 'Berlin Flagship' },
    'ct-channels': { online: 'Online' },
  },
  idMaps: {
    'ct-products': { 'SKU-123': 'prod-id-1' },
    'ct-categories': {
      c1: 'cat-id-1',
      '776ec960-83f3-45a3-8631-07c00ad9367e':
        '776ec960-83f3-45a3-8631-07c00ad9367e',
    },
    'ct-stores': { 'berlin-flagship': 'store-id-1' },
    // channels deliberately absent — no per-channel MC page.
  },
  sentinels,
};

const PROJECT_KEY = 'sp-demo';

const dim = (id: string): ColumnMeta => ({
  id,
  role: 'dimension',
  valueType: 'string',
  exactness: 'exact',
  nullMeaning: 'zero',
});

const metric: ColumnMeta = {
  id: 'revenue.net@orderdate',
  role: 'metric',
  valueType: 'money',
  exactness: 'exact',
  nullMeaning: 'zero',
};

describe('resolveDimensionValue', () => {
  it('resolves a category by its KEY', () => {
    expect(resolveDimensionValue(ctx, 'category', 'c1')).toBe('Hand Trucks');
  });

  it('resolves a category by its ID (UUID) when the key was never stored', () => {
    expect(
      resolveDimensionValue(
        ctx,
        'category',
        '776ec960-83f3-45a3-8631-07c00ad9367e'
      )
    ).toBe('Spare Parts');
  });

  it('renders the _none sentinel as the per-source label', () => {
    // Categories get "Uncategorised"; a source without an override gets the default "None".
    expect(resolveDimensionValue(ctx, 'category', NONE_SENTINEL)).toBe(
      'Uncategorised'
    );
    expect(resolveDimensionValue(ctx, 'store', NONE_SENTINEL)).toBe('None');
  });

  it('renders the __other__ long-tail sentinel as "Other"', () => {
    expect(resolveDimensionValue(ctx, 'category', OTHER_SENTINEL)).toBe('Other');
  });

  it('falls back to the raw value when no name resolves', () => {
    // An unknown key is shown raw rather than blanked — a key beats an empty cell.
    expect(resolveDimensionValue(ctx, 'category', 'c999')).toBe('c999');
  });

  it('leaves a non-CT dimension untouched', () => {
    // currency is a dsp dimension; GBP must stay GBP, never be looked up.
    expect(resolveDimensionValue(ctx, 'currency', 'GBP')).toBe('GBP');
  });

  it('passes null / undefined straight through', () => {
    expect(resolveDimensionValue(ctx, 'category', null)).toBeNull();
    expect(resolveDimensionValue(ctx, 'category', undefined as never)).toBe(
      undefined
    );
  });

  it('returns the raw value while a needed map is still loading', () => {
    const loadingCtx: DimensionLabelContext = { ...ctx, maps: {} };
    expect(resolveDimensionValue(loadingCtx, 'category', 'c1')).toBe('c1');
    // sentinels resolve even before the maps arrive.
    expect(resolveDimensionValue(loadingCtx, 'category', NONE_SENTINEL)).toBe(
      'Uncategorised'
    );
  });

  it('resolves stores and channels from their own maps', () => {
    expect(resolveDimensionValue(ctx, 'store', 'berlin-flagship')).toBe(
      'Berlin Flagship'
    );
    expect(resolveDimensionValue(ctx, 'distributionChannel', 'online')).toBe(
      'Online'
    );
  });

  it('formats a product as "<name> (<sku>)" when the name resolves', () => {
    expect(resolveDimensionValue(ctx, 'product', 'SKU-123')).toBe(
      'Pallet Jack 2.5t (SKU-123)'
    );
  });

  it('falls back to the raw SKU for a product with no resolved name', () => {
    expect(resolveDimensionValue(ctx, 'product', 'SKU-UNKNOWN')).toBe(
      'SKU-UNKNOWN'
    );
  });
});

describe('resolveDimensionHref', () => {
  it('builds a product deep link from its SKU', () => {
    expect(resolveDimensionHref(ctx, PROJECT_KEY, 'product', 'SKU-123')).toBe(
      '/sp-demo/products/prod-id-1'
    );
  });

  it('builds a category deep link by KEY and by ID', () => {
    expect(resolveDimensionHref(ctx, PROJECT_KEY, 'category', 'c1')).toBe(
      '/sp-demo/categories/cat-id-1'
    );
    expect(
      resolveDimensionHref(
        ctx,
        PROJECT_KEY,
        'category',
        '776ec960-83f3-45a3-8631-07c00ad9367e'
      )
    ).toBe('/sp-demo/categories/776ec960-83f3-45a3-8631-07c00ad9367e');
  });

  it('builds a store deep link under settings/stores', () => {
    expect(
      resolveDimensionHref(ctx, PROJECT_KEY, 'store', 'berlin-flagship')
    ).toBe('/sp-demo/settings/stores/store-id-1');
  });

  it('returns no link for channels (no per-channel MC page)', () => {
    expect(
      resolveDimensionHref(ctx, PROJECT_KEY, 'distributionChannel', 'online')
    ).toBeUndefined();
  });

  it('returns no link for the sentinels', () => {
    expect(
      resolveDimensionHref(ctx, PROJECT_KEY, 'category', NONE_SENTINEL)
    ).toBeUndefined();
    expect(
      resolveDimensionHref(ctx, PROJECT_KEY, 'product', OTHER_SENTINEL)
    ).toBeUndefined();
  });

  it('returns no link for a non-CT dimension', () => {
    expect(
      resolveDimensionHref(ctx, PROJECT_KEY, 'currency', 'GBP')
    ).toBeUndefined();
  });

  it('returns no link when the id has not resolved', () => {
    expect(
      resolveDimensionHref(ctx, PROJECT_KEY, 'product', 'SKU-UNKNOWN')
    ).toBeUndefined();
  });

  it('returns no link when the project key is empty', () => {
    expect(resolveDimensionHref(ctx, '', 'product', 'SKU-123')).toBeUndefined();
  });
});

describe('resolveDimensionCell', () => {
  it('returns both the "<name> (<sku>)" label and the product href', () => {
    expect(resolveDimensionCell(ctx, PROJECT_KEY, 'product', 'SKU-123')).toEqual(
      { label: 'Pallet Jack 2.5t (SKU-123)', href: '/sp-demo/products/prod-id-1' }
    );
  });

  it('returns a label with no href for a channel', () => {
    expect(
      resolveDimensionCell(ctx, PROJECT_KEY, 'distributionChannel', 'online')
    ).toEqual({ label: 'Online' });
  });

  it('returns the sentinel label with no href', () => {
    expect(
      resolveDimensionCell(ctx, PROJECT_KEY, 'category', NONE_SENTINEL)
    ).toEqual({ label: 'Uncategorised' });
  });
});

describe('resolveRow', () => {
  const columns = [dim('category'), metric];

  it('labels dimension cells and leaves metric cells alone', () => {
    const row = { category: 'c1', 'revenue.net@orderdate': 12345 };
    expect(resolveRow(ctx, columns, row)).toEqual({
      category: 'Hand Trucks',
      'revenue.net@orderdate': 12345,
    });
  });

  it('returns the SAME row reference when nothing changes', () => {
    // Keeps React re-renders cheap and proves metric-only rows are not needlessly copied.
    const row = { category: 'c999', 'revenue.net@orderdate': 1 };
    expect(resolveRow(ctx, columns, row)).toBe(row);
  });

  it('does not mutate the input row', () => {
    const row = { category: 'c1', 'revenue.net@orderdate': 1 };
    resolveRow(ctx, columns, row);
    expect(row.category).toBe('c1');
  });
});

describe('ctValueSourcesFromReport', () => {
  it('keeps only CT-resolvable filters, keyed by dimension', () => {
    const report = {
      allowedFilters: [
        { dimension: 'category', valueSource: 'ct-categories' },
        { dimension: 'store', valueSource: 'ct-stores' },
        { dimension: 'currency', valueSource: 'dsp' },
        { dimension: 'priceBand', valueSource: 'static' },
      ],
    };
    expect(ctValueSourcesFromReport(report)).toEqual({
      category: 'ct-categories',
      store: 'ct-stores',
    });
  });

  it('tolerates a missing report', () => {
    expect(ctValueSourcesFromReport(undefined)).toEqual({});
  });
});

describe('isCtValueSource', () => {
  it('accepts the four CT sources and rejects the rest', () => {
    for (const source of CT_VALUE_SOURCES) {
      expect(isCtValueSource(source)).toBe(true);
    }
    expect(isCtValueSource('dsp')).toBe(false);
    expect(isCtValueSource('static')).toBe(false);
  });
});
