import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import type { ColumnMeta, SourceQuery } from '../shared/schema/query.js';
import { DspFailure } from '../shared/dsp/server.js';
import type { CategoryResolver } from '../shared-node/category-resolver.js';
import { CATEGORY_NONE } from '../shared-node/category-resolver.js';

/**
 * Live stock from the InventoryEntry API — the LOCAL, commercetools-native stock position.
 *
 * `inventory.available` is deliberately NOT read from Product Search facets: a `stats` facet is
 * query-global (one number for the whole result set, not per bucket) so it cannot break down by
 * product or location, and on a project where Product Search is not activated it is unavailable
 * entirely. InventoryEntry is a core resource present on every project, so reading it here lets
 * stock reporting work on local stock first, with no OMS/ERP connector and no Product Search.
 *
 * Grain served:
 *  - `supplyChannel` — the native stock location (a Channel with the InventorySupply role). Each
 *    entry has exactly one, so this is unambiguous and never double-counts. (Deliberately NOT
 *    `store`: a supply channel can belong to several stores, so a store breakdown would fan the
 *    same stock out across stores and inflate the total.)
 *  - `product` — the variant SKU, carried directly on the entry.
 *  - `category` — resolved from the SKU's product via the shared category resolver.
 *
 * `availableQuantity` (on-hand minus reservations — what is actually sellable) is preferred over
 * `quantityOnStock`; a null available falls back to on-stock.
 */

/** Dimensions this reader can group by (anything else is refused, not silently dropped). */
const INVENTORY_DIMENSIONS = new Set(['supplyChannel', 'product', 'category']);

const NONE = '_none';

export interface InventoryResult {
  columns: ColumnMeta[];
  rows: Array<Array<string | number | null>>;
  partial: boolean;
  upstreamRequests: number;
}

interface InventoryEntryDoc {
  id: string;
  sku: string;
  quantityOnStock?: number;
  availableQuantity?: number;
  supplyChannel?: { id: string } | null;
}

/** Channel id → key, built once so supplyChannel rows carry a readable key, not a UUID. */
let channelKeyCache: Promise<Map<string, string>> | undefined;

const buildChannelKeyMap = async (
  root: ByProjectKeyRequestBuilder
): Promise<Map<string, string>> => {
  const byId = new Map<string, string>();
  for (let offset = 0; ; offset += 500) {
    const res = await root.channels().get({ queryArgs: { limit: 500, offset } }).execute();
    const body = res.body as { results: Array<{ id: string; key?: string }>; count: number };
    for (const c of body.results) byId.set(c.id, c.key ?? c.id);
    if (body.results.length < 500) break;
  }
  return byId;
};

const getChannelKeyMap = (root: ByProjectKeyRequestBuilder): Promise<Map<string, string>> => {
  if (!channelKeyCache) channelKeyCache = buildChannelKeyMap(root);
  return channelKeyCache;
};

/** Test hook: forces the channel map to rebuild on the next read. */
export const resetChannelKeyCache = (): void => {
  channelKeyCache = undefined;
};

/** The in/eq filter values for a dimension, as a Set of strings, or null if unfiltered. */
const filterValuesFor = (query: SourceQuery, dimension: string): Set<string> | null => {
  const values = new Set<string>();
  let present = false;
  for (const filter of query.filters) {
    if (filter.dimension !== dimension) continue;
    if ('values' in filter && filter.op === 'in') {
      present = true;
      for (const v of filter.values) values.add(String(v));
    } else if ('value' in filter && filter.op === 'eq') {
      present = true;
      values.add(String(filter.value));
    }
  }
  return present ? values : null;
};

export const readInventory = async (
  root: ByProjectKeyRequestBuilder,
  query: SourceQuery,
  resolver: CategoryResolver
): Promise<InventoryResult> => {
  const breakdown = query.dimensions.filter((d) => d !== 'currency');
  for (const dim of breakdown) {
    if (!INVENTORY_DIMENSIONS.has(dim)) {
      throw new DspFailure(
        'UNSUPPORTED_DIMENSION',
        `Stock (inventory.available) cannot be broken down by "${dim}". ` +
          `Supported: ${[...INVENTORY_DIMENSIONS].join(', ')}.`
      );
    }
  }

  const channelKeyById = await getChannelKeyMap(root);

  const productFilter = filterValuesFor(query, 'product');
  const categoryFilter = filterValuesFor(query, 'category');
  const channelFilter = filterValuesFor(query, 'supplyChannel');
  // Row-level scope: a scoped subject only sees their own supply channels.
  const scopeChannels =
    !query.scope.unrestricted && query.scope.channels ? new Set(query.scope.channels) : null;

  // Group sums keyed by the requested breakdown tuple.
  const groups = new Map<string, { key: Record<string, string>; value: number }>();
  let upstreamRequests = 0;
  let lastId: string | null = null;

  for (;;) {
    const where = lastId ? `id > "${lastId}"` : undefined;
    const res = await root
      .inventory()
      .get({ queryArgs: { limit: 500, sort: 'id asc', ...(where ? { where } : {}) } })
      .execute();
    upstreamRequests += 1;
    const body = res.body as { results: InventoryEntryDoc[]; count: number };
    for (const entry of body.results) {
      const sku = entry.sku;
      const channelKey = entry.supplyChannel
        ? channelKeyById.get(entry.supplyChannel.id) ?? entry.supplyChannel.id
        : NONE;
      const category = resolver.categoryOfSku(sku) || CATEGORY_NONE;

      if (productFilter && !productFilter.has(sku)) continue;
      if (channelFilter && !channelFilter.has(channelKey)) continue;
      if (categoryFilter && !categoryFilter.has(category)) continue;
      if (scopeChannels && channelKey !== NONE && !scopeChannels.has(channelKey)) continue;

      const available = entry.availableQuantity ?? entry.quantityOnStock ?? 0;
      const keyParts: Record<string, string> = {};
      for (const dim of breakdown) {
        keyParts[dim] =
          dim === 'supplyChannel' ? channelKey : dim === 'product' ? sku : category;
      }
      const mapKey = breakdown.map((d) => keyParts[d]).join('\u0000');
      const target = groups.get(mapKey) ?? { key: keyParts, value: 0 };
      target.value += available;
      groups.set(mapKey, target);
    }
    if (body.results.length < 500) break;
    lastId = body.results[body.results.length - 1].id;
  }

  const columns: ColumnMeta[] = [
    ...breakdown.map((id) => ({
      id,
      role: 'dimension' as const,
      valueType: 'string' as const,
      exactness: 'exact' as const,
      nullMeaning: 'unknown' as const,
    })),
    {
      id: 'inventory.available',
      role: 'metric' as const,
      valueType: 'count' as const,
      exactness: 'exact' as const,
      nullMeaning: 'zero' as const,
    },
  ];

  const rows: Array<Array<string | number | null>> =
    breakdown.length === 0
      ? [[[...groups.values()].reduce((sum, g) => sum + g.value, 0)]]
      : [...groups.values()].map((g) => [...breakdown.map((d) => g.key[d] ?? null), g.value]);

  return { columns, rows, partial: false, upstreamRequests: upstreamRequests || 1 };
};
