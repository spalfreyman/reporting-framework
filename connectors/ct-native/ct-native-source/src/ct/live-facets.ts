import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import type { ColumnMeta, SourceQuery } from '../shared/schema/query.js';
import { DspFailure } from '../shared/dsp/server.js';

/**
 * Live catalogue metrics via Product Search facets.
 *
 * This is the half of commercetools that genuinely does aggregate: Product Search supports
 * `count`, `ranges` and `stats` facets, so catalogue, price and inventory reporting needs no
 * materialization and is always current.
 *
 * Two documented caps shape what is possible, and both are surfaced honestly rather than
 * silently truncating:
 *  - a facet returns at most 200 terms, so a breakdown is top-200 and flagged partial;
 *  - a search request returns at most 100 results and offsets cap at 10,000.
 */

export const FACET_TERM_CAP = 200;

/**
 * Product Search is an opt-in feature. On a project where it has never been provisioned the
 * endpoint answers 404 "Project does not exist" — misleading, but that is what it returns.
 * Detect it so the connector can advertise honestly rather than 500 per query.
 */
export const isProductSearchUnavailable = (error: unknown): boolean => {
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;
  const body =
    typeof error === 'object' && error !== null && 'body' in error
      ? JSON.stringify((error as { body?: unknown }).body)
      : '';
  return status === 404 || /does not exist/i.test(body);
};

/**
 * A cheap startup probe: is Product Search usable on this project? Used to decide whether the
 * descriptor should advertise the live catalogue metrics at all.
 */
export const probeProductSearch = async (
  root: ByProjectKeyRequestBuilder
): Promise<boolean> => {
  try {
    await root
      .products()
      .search()
      .post({ body: { query: undefined, limit: 0 } as never })
      .execute();
    return true;
  } catch (error) {
    if (isProductSearchUnavailable(error)) return false;
    // Any other error (auth, transient) should not be read as "feature absent" — assume it
    // is there and let real queries surface the real problem.
    return true;
  }
};

/** Facet field for each dimension we can break down by. */
const FACET_FIELD: Record<string, string> = {
  category: 'categoriesSubTree',
  productType: 'productType',
  brand: 'variants.attributes.brand',
};

const MONEY_FIELD = 'variants.prices.centAmount';

export interface LiveFacetResult {
  columns: ColumnMeta[];
  rows: Array<Array<string | number | null>>;
  partial: boolean;
  detail?: string;
  upstreamRequests: number;
}

const currencyFilterOf = (query: SourceQuery): string | null => {
  for (const filter of query.filters) {
    if (filter.dimension !== 'currency') continue;
    if ('value' in filter) return String(filter.value);
    if ('values' in filter && filter.values.length === 1) return String(filter.values[0]);
  }
  return null;
};

const PRICE_METRICS = new Set(['price.min', 'price.max', 'price.mean']);

/**
 * Builds and runs the Product Search request.
 *
 * Note the currency guard: a `stats` facet on a money field returns a BARE NUMBER with no
 * currency attached. Aggregating that across a multi-currency catalogue would produce a
 * meaningless figure, so a price query without a single pinned currency is refused rather
 * than answered wrongly.
 */
export const readLiveFacets = async (
  root: ByProjectKeyRequestBuilder,
  query: SourceQuery,
  priceBands: number[]
): Promise<LiveFacetResult> => {
  const wantsPrice = query.metrics.some((m) => PRICE_METRICS.has(m));
  const currency = currencyFilterOf(query);

  if (wantsPrice && !currency) {
    throw new DspFailure(
      'FILTER_REQUIRED',
      'Price statistics require exactly one currency to be selected: a stats facet on a ' +
        'money field returns a bare number, so mixing currencies would be meaningless.'
    );
  }

  const breakdown = query.dimensions.find((d) => d !== 'currency' && d !== 'priceBand');
  const wantsPriceBands = query.dimensions.includes('priceBand');

  if (breakdown && !FACET_FIELD[breakdown]) {
    throw new DspFailure(
      'UNSUPPORTED_DIMENSION',
      `Live catalogue metrics cannot be broken down by "${breakdown}"`
    );
  }

  const facets: unknown[] = [];
  if (breakdown) {
    facets.push({
      distinct: {
        name: 'breakdown',
        field: FACET_FIELD[breakdown],
        scope: 'query',
        level: 'products',
        limit: FACET_TERM_CAP,
      },
    });
  }
  if (wantsPriceBands) {
    facets.push({
      ranges: {
        name: 'priceBands',
        field: MONEY_FIELD,
        scope: 'query',
        level: 'variants',
        ranges: [
          { key: `under-${priceBands[0]}`, to: priceBands[0] },
          ...priceBands.slice(0, -1).map((from, index) => ({
            key: `${from}-${priceBands[index + 1]}`,
            from,
            to: priceBands[index + 1],
          })),
          { key: `${priceBands[priceBands.length - 1]}-plus`, from: priceBands[priceBands.length - 1] },
        ],
      },
    });
  }
  if (wantsPrice) {
    facets.push({
      stats: { name: 'priceStats', field: MONEY_FIELD, scope: 'query', level: 'variants' },
    });
  }

  const filters: unknown[] = [];
  if (currency) {
    filters.push({ exact: { field: 'variants.prices.currencyCode', value: currency } });
  }
  for (const filter of query.filters) {
    if (filter.dimension === 'currency') continue;
    const field = FACET_FIELD[filter.dimension];
    if (!field) continue;
    if ('values' in filter && filter.op === 'in') {
      filters.push({ exact: { field, values: filter.values.map(String) } });
    } else if ('value' in filter && filter.op === 'eq') {
      filters.push({ exact: { field, value: String(filter.value) } });
    }
  }

  let response;
  try {
    response = await root
      .products()
      .search()
      .post({
        body: {
          query: filters.length > 0 ? { and: filters } : undefined,
          facets: facets.length > 0 ? facets : undefined,
          limit: 0,
          markMatchingVariants: false,
        } as never,
      })
      .execute();
  } catch (error) {
    if (isProductSearchUnavailable(error)) {
      throw new DspFailure(
        'UPSTREAM_UNAVAILABLE',
        'Product Search is not activated for this commercetools project, so live catalogue ' +
          'metrics cannot be served. Activate Product Search to enable catalogue reporting.',
        { retryable: false }
      );
    }
    throw error;
  }

  const body = response.body as unknown as {
    total?: number;
    facets?: Array<{
      name: string;
      buckets?: Array<{ key: string; count: number }>;
      min?: number;
      max?: number;
      mean?: number;
      sum?: number;
      count?: number;
    }>;
  };

  const facetByName = new Map((body.facets ?? []).map((f) => [f.name, f]));
  const stats = facetByName.get('priceStats');

  const metricValue = (metricId: string, count: number | null): number | null => {
    switch (metricId) {
      case 'products.count':
        return count;
      case 'variants.count':
        return stats?.count ?? count;
      case 'price.min':
        return stats?.min ?? null;
      case 'price.max':
        return stats?.max ?? null;
      case 'price.mean':
        return stats?.mean ?? null;
      default:
        return null;
    }
  };

  const columns: ColumnMeta[] = [
    ...(breakdown
      ? [
          {
            id: breakdown,
            role: 'dimension' as const,
            valueType: 'string' as const,
            exactness: 'exact' as const,
            nullMeaning: 'unknown' as const,
          },
        ]
      : []),
    ...(wantsPriceBands
      ? [
          {
            id: 'priceBand',
            role: 'dimension' as const,
            valueType: 'string' as const,
            exactness: 'exact' as const,
            nullMeaning: 'unknown' as const,
          },
        ]
      : []),
    ...query.metrics.map((id) => ({
      id,
      role: 'metric' as const,
      valueType: (PRICE_METRICS.has(id) ? 'money' : 'count') as 'money' | 'count',
      ...(PRICE_METRICS.has(id) && currency ? { currencyCode: currency, fractionDigits: 2 } : {}),
      exactness: 'exact' as const,
      nullMeaning: 'zero' as const,
    })),
  ];

  let rows: Array<Array<string | number | null>>;
  let partial = false;
  let detail: string | undefined;

  if (breakdown) {
    const buckets = facetByName.get('breakdown')?.buckets ?? [];
    rows = buckets.map((bucket) => [
      bucket.key,
      ...(wantsPriceBands ? [null] : []),
      ...query.metrics.map((id) => metricValue(id, bucket.count)),
    ]);
    if (buckets.length >= FACET_TERM_CAP) {
      partial = true;
      detail = `Showing the top ${FACET_TERM_CAP} values: a facet returns at most ${FACET_TERM_CAP} terms.`;
    }
  } else if (wantsPriceBands) {
    const buckets = facetByName.get('priceBands')?.buckets ?? [];
    rows = buckets.map((bucket) => [
      bucket.key,
      ...query.metrics.map((id) => metricValue(id, bucket.count)),
    ]);
  } else {
    rows = [[...query.metrics.map((id) => metricValue(id, body.total ?? 0))]];
  }

  return { columns, rows, partial, ...(detail ? { detail } : {}), upstreamRequests: 1 };
};
