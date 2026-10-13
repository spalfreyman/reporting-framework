import { describe, expect, it } from './harness.js';
import { readInventory, resetChannelKeyCache } from '../src/ct/inventory.js';
import { DspFailure } from '../src/shared/dsp/server.js';
import type { SourceQuery } from '../src/shared/schema/query.js';
import type { CategoryResolver } from '../src/shared-node/category-resolver.js';

/**
 * inventory.available is read from the core InventoryEntry API, NOT Product Search: it must
 * sum availableQuantity per supply channel / SKU, resolve channel ids to keys, and never fan a
 * shared channel out across stores. These are the behaviours stock-cover rests on.
 */

interface Entry {
  id: string;
  sku: string;
  availableQuantity?: number;
  quantityOnStock?: number;
  supplyChannel?: { id: string } | null;
}

/** A stub apiRoot serving a fixed set of channels and inventory entries (single page). */
const stubRoot = (opts: {
  channels: Array<{ id: string; key?: string }>;
  entries: Entry[];
}) =>
  ({
    channels: () => ({
      get: () => ({
        execute: async () => ({ body: { results: opts.channels, count: opts.channels.length } }),
      }),
    }),
    inventory: () => ({
      get: ({ queryArgs }: { queryArgs: { where?: string } }) => ({
        execute: async () => ({
          // Keyset is `id > "x"`; the stub returns everything on the first (unfiltered) call
          // and an empty page thereafter, which terminates the loop.
          body: queryArgs.where
            ? { results: [], count: 0 }
            : { results: opts.entries, count: opts.entries.length },
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const resolver = (bySku: Record<string, string>): CategoryResolver => ({
  categoryOf: () => '_none',
  categoryOfSku: (sku?: string | null) => (sku && bySku[sku]) || '_none',
  size: Object.keys(bySku).length,
});

const query = (over: Partial<SourceQuery>): SourceQuery =>
  ({
    metrics: ['inventory.available'],
    dimensions: [],
    filters: [],
    scope: { unrestricted: true },
    ...over,
  }) as unknown as SourceQuery;

const catchError = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('readInventory', () => {
  const entries: Entry[] = [
    { id: 'i1', sku: 'A', availableQuantity: 10, supplyChannel: { id: 'ch-lon' } },
    { id: 'i2', sku: 'B', availableQuantity: 5, supplyChannel: { id: 'ch-lon' } },
    { id: 'i3', sku: 'A', availableQuantity: 7, supplyChannel: { id: 'ch-de' } },
    { id: 'i4', sku: 'C', quantityOnStock: 3, supplyChannel: null }, // no available → falls back
  ];
  const channels = [
    { id: 'ch-lon', key: 'london' },
    { id: 'ch-de', key: 'germany' },
  ];

  it('sums availableQuantity per supply channel, resolving channel id to key', async () => {
    resetChannelKeyCache();
    const result = await readInventory(
      stubRoot({ channels, entries }),
      query({ dimensions: ['supplyChannel'] }),
      resolver({})
    );
    const byChannel = Object.fromEntries(result.rows.map((r) => [r[0], r[1]]));
    expect(byChannel.london).toBe(15); // 10 + 5
    expect(byChannel.germany).toBe(7);
    expect(byChannel._none).toBe(3); // the channel-less entry, via quantityOnStock fallback
  });

  it('returns one grand total when no breakdown dimension is requested', async () => {
    resetChannelKeyCache();
    const result = await readInventory(
      stubRoot({ channels, entries }),
      query({ dimensions: [] }),
      resolver({})
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0][0]).toBe(25); // 10 + 5 + 7 + 3
  });

  it('breaks down by product (SKU) across channels', async () => {
    resetChannelKeyCache();
    const result = await readInventory(
      stubRoot({ channels, entries }),
      query({ dimensions: ['product'] }),
      resolver({})
    );
    const bySku = Object.fromEntries(result.rows.map((r) => [r[0], r[1]]));
    expect(bySku.A).toBe(17); // 10 (london) + 7 (germany)
  });

  it('filters by category via the SKU→category resolver', async () => {
    resetChannelKeyCache();
    const result = await readInventory(
      stubRoot({ channels, entries }),
      query({
        dimensions: ['product'],
        filters: [{ dimension: 'category', op: 'in', values: ['footwear'] }],
      }),
      resolver({ A: 'footwear', B: 'bags', C: 'footwear' })
    );
    const skus = result.rows.map((r) => r[0]).sort();
    expect(skus).toEqual(['A', 'C']); // B (bags) excluded
  });

  it('refuses an unsupported breakdown dimension rather than dropping it silently', async () => {
    resetChannelKeyCache();
    const error = await catchError(
      readInventory(
        stubRoot({ channels, entries }),
        query({ dimensions: ['brand'] }),
        resolver({})
      )
    );
    expect(error).toBeDefined();
    expect(error instanceof DspFailure).toBe(true);
  });
});
