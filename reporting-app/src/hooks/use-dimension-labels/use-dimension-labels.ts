import { useCallback, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { useMcQuery } from '@commercetools-frontend/application-shell';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { GRAPHQL_TARGETS } from '@commercetools-frontend/constants';
import FetchCategories from './fetch-categories.ctp.graphql';
import FetchStores from './fetch-stores.ctp.graphql';
import FetchChannels from './fetch-channels.ctp.graphql';
import FetchCustomerGroups from './fetch-customer-groups.ctp.graphql';
import FetchProducts from './fetch-products.ctp.graphql';
import { dimensionValueMessages } from '../../i18n/messages/shared';
import {
  ctValueSourcesFromReport,
  resolveRow,
  type CtValueSource,
  type DimensionLabelContext,
  type IdMap,
  type LabelMap,
  type SentinelLabels,
} from './resolve-labels';
import type { TileResult } from '../../types/reporting';
import type { ReportDefinition } from '../../shared/schema/report-definition';

/**
 * Presentation-only resolution of dimension VALUES (canonical keys) to localized names.
 *
 * It reads which filterable dimensions are CT-resolvable from the report's `allowedFilters`
 * `valueSource`, then fetches just the entity types it needs (categories / stores / channels
 * / customer groups) through the Merchant Center platform GraphQL — the operator's own
 * session, the same channel the rest of the app uses. The fetched maps resolve by BOTH key
 * and id so the category key/UUID-fallback the rollup stores both render as a name.
 *
 * Nothing here mutates the queried/filtered data model: `labelizeResult` returns a copy of a
 * tile's rows with only the displayed dimension cells swapped for names.
 */

type LocalizedName = { locale: string; value: string };
type LocalizedEntry = {
  id: string;
  key?: string | null;
  nameAllLocales?: LocalizedName[] | null;
};
type PlainEntry = { id: string; key?: string | null; name?: string | null };

type CategoriesResult = { categories: { results: LocalizedEntry[] } };
type StoresResult = { stores: { results: LocalizedEntry[] } };
type ChannelsResult = { channels: { results: LocalizedEntry[] } };
type CustomerGroupsResult = { customerGroups: { results: PlainEntry[] } };

type ProductVariant = { sku?: string | null };
type ProductEntry = {
  id: string;
  masterData?: {
    current?: {
      nameAllLocales?: LocalizedName[] | null;
      masterVariant?: ProductVariant | null;
      variants?: ProductVariant[] | null;
    } | null;
  } | null;
};
type ProductsResult = { products: { results: ProductEntry[] } };

/** Pick the name for the active locale, falling back by language then first available. */
const pickLocalized = (
  names: LocalizedName[] | null | undefined,
  locale: string
): string | undefined => {
  if (!names || names.length === 0) return undefined;
  const exact = names.find((n) => n.locale === locale);
  if (exact) return exact.value;
  const lang = locale.split('-')[0];
  const byLang = names.find((n) => n.locale.split('-')[0] === lang);
  return (byLang ?? names[0]).value;
};

const buildLocalizedMap = (
  entries: LocalizedEntry[],
  locale: string
): LabelMap => {
  const map: LabelMap = {};
  for (const entry of entries) {
    const name = pickLocalized(entry.nameAllLocales, locale);
    if (!name) continue;
    if (entry.key) map[entry.key] = name;
    if (entry.id) map[entry.id] = name;
  }
  return map;
};

const buildPlainMap = (entries: PlainEntry[]): LabelMap => {
  const map: LabelMap = {};
  for (const entry of entries) {
    if (!entry.name) continue;
    if (entry.key) map[entry.key] = entry.name;
    if (entry.id) map[entry.id] = entry.name;
  }
  return map;
};

/**
 * key→id / id→id, so a value stored as a canonical key still deep-links to the right entity.
 * The same shape serves categories, stores and channels.
 */
const buildIdMap = (
  entries: Array<{ id: string; key?: string | null }>
): IdMap => {
  const map: IdMap = {};
  for (const entry of entries) {
    if (!entry.id) continue;
    if (entry.key) map[entry.key] = entry.id;
    map[entry.id] = entry.id;
  }
  return map;
};

/**
 * Products are keyed in reports by variant SKU. Build sku→name (for the display label) and
 * sku→productId (for the deep link) across the master variant and every variant, so any SKU
 * that can appear in a result resolves to its product.
 */
const buildProductMaps = (
  entries: ProductEntry[],
  locale: string
): { names: LabelMap; ids: IdMap } => {
  const names: LabelMap = {};
  const ids: IdMap = {};
  for (const entry of entries) {
    const current = entry.masterData?.current;
    if (!current) continue;
    const name = pickLocalized(current.nameAllLocales, locale);
    const variants = [
      current.masterVariant,
      ...(current.variants ?? []),
    ];
    for (const variant of variants) {
      const sku = variant?.sku;
      if (!sku) continue;
      if (name) names[sku] = name;
      if (entry.id) ids[sku] = entry.id;
    }
  }
  return { names, ids };
};

const QUERY_CONTEXT = {
  context: { target: GRAPHQL_TARGETS.COMMERCETOOLS_PLATFORM },
};

export type UseDimensionLabelsResult = {
  /** True while a needed entity type is still being fetched. */
  loading: boolean;
  ctx: DimensionLabelContext;
  /** The current project key, for building `/<projectKey>/...` MC deep links. */
  projectKey: string;
  /** A copy of a tile result with dimension cells (primary + comparison) labelled. */
  labelizeResult: (result: TileResult) => TileResult;
};

export const useDimensionLabels = (
  report?: Pick<ReportDefinition, 'allowedFilters'>
): UseDimensionLabelsResult => {
  const intl = useIntl();
  const locale = useApplicationContext((context) => context.dataLocale ?? 'en');
  const projectKey = useApplicationContext(
    (context) => context.project?.key ?? ''
  );

  const valueSourceByDimension = useMemo(
    () => ctValueSourcesFromReport(report),
    [report]
  );
  const needed = useMemo(
    () => new Set<CtValueSource>(Object.values(valueSourceByDimension)),
    [valueSourceByDimension]
  );

  // Rules of hooks: every query runs on every render; `skip` makes the unneeded ones inert.
  const categories = useMcQuery<CategoriesResult>(FetchCategories, {
    ...QUERY_CONTEXT,
    skip: !needed.has('ct-categories'),
  });
  const stores = useMcQuery<StoresResult>(FetchStores, {
    ...QUERY_CONTEXT,
    skip: !needed.has('ct-stores'),
  });
  const channels = useMcQuery<ChannelsResult>(FetchChannels, {
    ...QUERY_CONTEXT,
    skip: !needed.has('ct-channels'),
  });
  const customerGroups = useMcQuery<CustomerGroupsResult>(FetchCustomerGroups, {
    ...QUERY_CONTEXT,
    skip: !needed.has('ct-customer-groups'),
  });
  const products = useMcQuery<ProductsResult>(FetchProducts, {
    ...QUERY_CONTEXT,
    skip: !needed.has('ct-products'),
  });

  const maps = useMemo(() => {
    const next: Partial<Record<CtValueSource, LabelMap>> = {};
    if (categories.data) {
      next['ct-categories'] = buildLocalizedMap(
        categories.data.categories.results,
        locale
      );
    }
    if (stores.data) {
      next['ct-stores'] = buildLocalizedMap(stores.data.stores.results, locale);
    }
    if (channels.data) {
      next['ct-channels'] = buildLocalizedMap(
        channels.data.channels.results,
        locale
      );
    }
    if (customerGroups.data) {
      next['ct-customer-groups'] = buildPlainMap(
        customerGroups.data.customerGroups.results
      );
    }
    if (products.data) {
      next['ct-products'] = buildProductMaps(
        products.data.products.results,
        locale
      ).names;
    }
    return next;
  }, [
    categories.data,
    stores.data,
    channels.data,
    customerGroups.data,
    products.data,
    locale,
  ]);

  const idMaps = useMemo(() => {
    const next: Partial<Record<CtValueSource, IdMap>> = {};
    if (categories.data) {
      next['ct-categories'] = buildIdMap(categories.data.categories.results);
    }
    if (stores.data) {
      next['ct-stores'] = buildIdMap(stores.data.stores.results);
    }
    if (products.data) {
      next['ct-products'] = buildProductMaps(
        products.data.products.results,
        locale
      ).ids;
    }
    return next;
  }, [categories.data, stores.data, products.data, locale]);

  const sentinels = useMemo<SentinelLabels>(
    () => ({
      noneByValueSource: {
        'ct-categories': intl.formatMessage(
          dimensionValueMessages['dimensionValue.uncategorised']
        ),
      },
      noneDefault: intl.formatMessage(
        dimensionValueMessages['dimensionValue.none']
      ),
      other: intl.formatMessage(dimensionValueMessages['dimensionValue.other']),
    }),
    [intl]
  );

  const ctx = useMemo<DimensionLabelContext>(
    () => ({ valueSourceByDimension, maps, idMaps, sentinels }),
    [valueSourceByDimension, maps, idMaps, sentinels]
  );

  const labelizeResult = useCallback(
    (result: TileResult): TileResult => {
      const rows = result.rows.map((row) =>
        resolveRow(ctx, result.columns, row)
      );
      if (!result.comparison) return { ...result, rows };
      return {
        ...result,
        rows,
        comparison: {
          ...result.comparison,
          rows: result.comparison.rows.map((row) =>
            resolveRow(ctx, result.columns, row)
          ),
        },
      };
    },
    [ctx]
  );

  const loading =
    (needed.has('ct-categories') && categories.loading) ||
    (needed.has('ct-stores') && stores.loading) ||
    (needed.has('ct-channels') && channels.loading) ||
    (needed.has('ct-customer-groups') && customerGroups.loading) ||
    (needed.has('ct-products') && products.loading);

  return { loading, ctx, projectKey, labelizeResult };
};
