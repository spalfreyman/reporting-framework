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
interface ProductProjectionDoc {
  id: string;
  categories?: CategoryRef[];
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
  for (const p of products) {
    const first = p.categories?.[0];
    if (first) byProduct.set(p.id, keyById.get(first.id) ?? first.id);
  }

  return {
    size: byProduct.size,
    categoryOf: (productId?: string | null) =>
      (productId && byProduct.get(productId)) || CATEGORY_NONE,
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
