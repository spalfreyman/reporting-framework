import { describe, expect, it } from './harness.js';
import { productSearchStatus, readLiveFacets } from '../src/ct/live-facets.js';
import { DspFailure } from '../src/shared/dsp/server.js';
import type { SourceQuery } from '../src/shared/schema/query.js';

/**
 * The live catalogue path must (a) facet on real searchable fields, and (b) never let a raw
 * Product Search error escape — the DSP harness turns any non-DspFailure into an opaque
 * "internal error" with no diagnosable cause. Both are covered here.
 */

/** A stub apiRoot that records the posted search body, then returns or throws. */
const stubRoot = (opts: { capture?: (body: unknown) => void; result?: unknown; error?: unknown }) =>
  ({
    products: () => ({
      search: () => ({
        post: ({ body }: { body: unknown }) => ({
          execute: async () => {
            opts.capture?.(body);
            if (opts.error) throw opts.error;
            return { body: opts.result ?? { total: 0, facets: [] } };
          },
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const query = (over: Partial<SourceQuery>): SourceQuery =>
  ({ metrics: [], dimensions: [], filters: [], ...over }) as unknown as SourceQuery;

const catchError = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('readLiveFacets request shaping', () => {
  it('facets a category breakdown on `categories`, not the subtree query field', async () => {
    let captured: { facets?: Array<{ distinct?: { field?: string } }> } | undefined;
    const root = stubRoot({
      capture: (b) => (captured = b as typeof captured),
      result: { total: 0, facets: [{ name: 'breakdown', buckets: [] }] },
    });

    await readLiveFacets(root, query({ metrics: ['products.count'], dimensions: ['category'] }), [1000]);

    const distinct = captured?.facets?.find((f) => f.distinct)?.distinct;
    expect(distinct?.field).toBe('categories');
  });
});

describe('readLiveFacets query expression', () => {
  it('passes a lone filter on its own, not wrapped in `and` (Product Search rejects single-expression `and`)', async () => {
    let captured: { query?: unknown } | undefined;
    const root = stubRoot({ capture: (b) => (captured = b as typeof captured), result: { total: 7 } });
    await readLiveFacets(
      root,
      query({ metrics: ['products.count'], filters: [{ dimension: 'currency', op: 'eq', value: 'EUR' }] }),
      [1000]
    );
    // a single filter must be the bare expression, never { and: [one] }
    expect(captured?.query && typeof captured.query === 'object' && 'and' in (captured.query as object)).toBe(false);
    expect(JSON.stringify(captured?.query)).toBe(JSON.stringify({ exact: { field: 'variants.prices.currencyCode', value: 'EUR' } }));
  });

  it('combines 2+ filters with `and`', async () => {
    let captured: { query?: { and?: unknown[] } } | undefined;
    const root = stubRoot({ capture: (b) => (captured = b as typeof captured), result: { total: 3 } });
    await readLiveFacets(
      root,
      query({
        metrics: ['products.count'],
        filters: [
          { dimension: 'currency', op: 'eq', value: 'EUR' },
          { dimension: 'productType', op: 'eq', value: 'pt-1' },
        ],
      }),
      [1000]
    );
    expect(Array.isArray(captured?.query?.and)).toBe(true);
    expect(captured?.query?.and?.length).toBe(2);
  });
});

describe('readLiveFacets error translation', () => {
  const run = (error: unknown) =>
    readLiveFacets(stubRoot({ error }), query({ metrics: ['products.count'] }), [1000]);

  it('maps a 403 to a typed UPSTREAM_AUTH failure (scope / activation), not a raw throw', async () => {
    const error = await catchError(run({ statusCode: 403 }));
    expect(error instanceof DspFailure).toBe(true);
    expect((error as DspFailure).code).toBe('UPSTREAM_AUTH');
  });

  it('maps a 400 to a typed INTERNAL failure (connector built a bad query)', async () => {
    const error = await catchError(run({ statusCode: 400 }));
    expect(error instanceof DspFailure).toBe(true);
    expect((error as DspFailure).code).toBe('INTERNAL');
  });

  it('still maps the not-activated 404 to UPSTREAM_UNAVAILABLE', async () => {
    const error = await catchError(run({ statusCode: 404 }));
    expect((error as DspFailure).code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('maps an unknown/transient error to a retryable UPSTREAM_UNAVAILABLE', async () => {
    const error = await catchError(run({ statusCode: 503 }));
    expect((error as DspFailure).code).toBe('UPSTREAM_UNAVAILABLE');
    expect((error as DspFailure).options.retryable).toBe(true);
  });
});

describe('productSearchStatus', () => {
  it('reads statusCode and nested body.statusCode, else undefined', () => {
    expect(productSearchStatus({ statusCode: 403 })).toBe(403);
    expect(productSearchStatus({ body: { statusCode: 400 } })).toBe(400);
    expect(productSearchStatus('nope')).toBe(undefined);
  });
});
