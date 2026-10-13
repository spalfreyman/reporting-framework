import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';

/**
 * Resolves a line item's product to its reporting category key.
 *
 * An order line carries only `productId`, never the product's category, so the rollup must
 * look it up. This builds two maps once per process — category id → key, and product id →
 * category key — from Product Projections and Categories, then answers point lookups from
 * memory. The result is memoised: product↔category rarely changes, and a redeploy refreshes
 * it. Needs `view_products` and `view_categories` (both covered by `manage_project`).
 */

export const CATEGORY_NONE = '_none';

export interface CategoryResolver {
  categoryOf(productId?: string | null): string;
  /**
   * Resolves a variant SKU to its reporting category key. InventoryEntry (and other
   * SKU-grain resources) carry only the SKU, never the productId, so stock reporting needs
   * this SKU-keyed view of the same product↔category map.
   */
  categoryOfSku(sku?: string | null): string;
  /** How many products were mapped — useful for a one-line log after priming. */
  size: number;
}

interface CategoryRef {
  id: string;
}
interface CategoryDoc {
  id: string;
  key?: string;
  ancestors?: CategoryRef[];
}
interface VariantRef {
  sku?: string;
}
interface ProductProjectionDoc {
  id: string;
  categories?: CategoryRef[];
  masterVariant?: VariantRef;
  variants?: VariantRef[];
}

const pageThrough = async <T>(
  fetchPage: (limit: number, offset: number) => Promise<{ results: T[]; total?: number }>
): Promise<T[]> => {
  const limit = 500;
  const all: T[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await fetchPage(limit, offset);
    all.push(...page.results);
    if (page.results.length < limit) break;
  }
  return all;
};

const buildResolver = async (root: ByProjectKeyRequestBuilder): Promise<CategoryResolver> => {
  const categories = (await pageThrough<CategoryDoc>(async (limit, offset) => {
    const res = await root.categories().get({ queryArgs: { limit, offset } }).execute();
    return res.body as { results: CategoryDoc[]; total?: number };
  }));
  const keyById = new Map<string, string>();
  for (const c of categories) keyById.set(c.id, c.key ?? c.id);

  const products = await pageThrough<ProductProjectionDoc>(async (limit, offset) => {
    const res = await root
      .productProjections()
      .get({ queryArgs: { staged: false, limit, offset } })
      .execute();
    return res.body as { results: ProductProjectionDoc[]; total?: number };
  });

  const byProduct = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const p of products) {
    const first = p.categories?.[0];
    if (!first) continue;
    const categoryKey = keyById.get(first.id) ?? first.id;
    byProduct.set(p.id, categoryKey);
    for (const variant of [p.masterVariant, ...(p.variants ?? [])]) {
      if (variant?.sku) bySku.set(variant.sku, categoryKey);
    }
  }

  return {
    size: byProduct.size,
    categoryOf: (productId?: string | null) =>
      (productId && byProduct.get(productId)) || CATEGORY_NONE,
    categoryOfSku: (sku?: string | null) => (sku && bySku.get(sku)) || CATEGORY_NONE,
  };
};

let cached: Promise<CategoryResolver> | undefined;

/** Memoised resolver: builds the maps on first call, reuses them thereafter. */
export const getCategoryResolver = (root: ByProjectKeyRequestBuilder): Promise<CategoryResolver> => {
  if (!cached) cached = buildResolver(root);
  return cached;
};

/** Test hook / forces a rebuild on the next getCategoryResolver call. */
export const resetCategoryResolver = (): void => {
  cached = undefined;
};
