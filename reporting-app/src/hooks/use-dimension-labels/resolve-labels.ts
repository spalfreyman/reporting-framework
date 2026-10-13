import type { ColumnMeta } from '../../shared/schema/query';
import type { Cell, Row } from '../../types/reporting';

/**
 * Pure, network-free label resolution for dimension VALUES.
 *
 * The gateway returns dimension values as canonical keys by design — keys are the
 * cross-source join key and must never change. Turning a key into a human name is purely a
 * presentation concern, so it lives here on the frontend and is applied only to DISPLAYED
 * text. The data model used for querying, filtering and links keeps the raw keys.
 *
 * Everything in this module is a pure function so it can be unit-tested without a browser,
 * Apollo, or the Merchant Center session.
 */

/** The `valueSource` values that map to a commercetools resource with a localized name. */
export type CtValueSource =
  | 'ct-products'
  | 'ct-categories'
  | 'ct-stores'
  | 'ct-channels'
  | 'ct-customer-groups';

export const CT_VALUE_SOURCES: readonly CtValueSource[] = [
  'ct-products',
  'ct-categories',
  'ct-stores',
  'ct-channels',
  'ct-customer-groups',
];

/**
 * Per-source Merchant Center route segment for deep-linking a dimension value to its entity
 * page. Only the sources with a stable single-entity MC page appear here:
 *
 *   product  → /<projectKey>/products/<productId>
 *   category → /<projectKey>/categories/<categoryId>
 *   store    → /<projectKey>/settings/stores/<storeId>
 *
 * Channels have no standard per-channel MC page, and customer groups are not deep-linked, so
 * both are intentionally absent — their values render as label-only text.
 */
export const DEEP_LINK_ROUTE: Partial<Record<CtValueSource, string>> = {
  'ct-products': 'products',
  'ct-categories': 'categories',
  'ct-stores': 'settings/stores',
};

export const isCtValueSource = (value: string): value is CtValueSource =>
  (CT_VALUE_SOURCES as readonly string[]).includes(value);

/**
 * Sentinel row values the rollup resolver emits. `_none` is an uncategorised / missing
 * bucket; `__other__` is the long-tail bucket a top-N query folds the remainder into.
 */
export const NONE_SENTINEL = '_none';
export const OTHER_SENTINEL = '__other__';

/** A `key`→name / `id`→name lookup for one value source. */
export type LabelMap = Record<string, string>;

/**
 * A `key`→id / `id`→id lookup for one value source, used to build a deep link to the entity's
 * Merchant Center page. The display name lives in `LabelMap`; this carries only the id the
 * route needs, so a value resolved by its canonical key still links to the right entity.
 */
export type IdMap = Record<string, string>;

/** Localized labels for the sentinel row values, resolved by the caller via `intl`. */
export type SentinelLabels = {
  /** Per-source override for `_none` (e.g. "Uncategorised" for categories). */
  noneByValueSource: Partial<Record<CtValueSource, string>>;
  /** Fallback for `_none` when a source has no override (e.g. "None"). */
  noneDefault: string;
  /** Shown for `__other__`. */
  other: string;
};

export type DimensionLabelContext = {
  /** dimensionId → valueSource, derived from the report's `allowedFilters`. */
  valueSourceByDimension: Record<string, CtValueSource>;
  /** valueSource → (key|id → localized name). Absent while the maps are still loading. */
  maps: Partial<Record<CtValueSource, LabelMap>>;
  /** valueSource → (key|id → entity id) for deep-linking. Absent while still loading. */
  idMaps?: Partial<Record<CtValueSource, IdMap>>;
  sentinels: SentinelLabels;
};

/** A resolved dimension cell: the display label, plus an optional deep-link href. */
export type ResolvedCell = {
  label: string;
  /** Same-origin absolute path to the entity's MC page; absent when not linkable. */
  href?: string;
};

/** The context a renderer needs to turn a raw dimension value into a labelled, linked cell. */
export type TableLabelContext = {
  ctx: DimensionLabelContext;
  /** The current project key, for building `/<projectKey>/...` MC deep links. */
  projectKey: string;
};

/** dimensionId → valueSource for every CT-resolvable filterable dimension of a report. */
export const ctValueSourcesFromReport = (report?: {
  allowedFilters?: Array<{ dimension: string; valueSource?: string }>;
}): Record<string, CtValueSource> => {
  const out: Record<string, CtValueSource> = {};
  for (const filter of report?.allowedFilters ?? []) {
    if (filter.valueSource && isCtValueSource(filter.valueSource)) {
      out[filter.dimension] = filter.valueSource;
    }
  }
  return out;
};

/**
 * Map one dimension cell's canonical key/id to its display label.
 *
 * Resolution order: a dimension that is not CT-resolvable is returned untouched; the two
 * sentinels resolve to their human labels; a key or id found in the map resolves to the
 * localized name; anything else falls back to the raw value — a raw key is always better
 * than a blank, and a name is a nicety, never a requirement.
 *
 * Category maps carry BOTH the category key and the category id, because the rollup stores
 * the key when a category has one and otherwise falls back to the id (a bare UUID).
 */
export const resolveDimensionValue = (
  ctx: DimensionLabelContext,
  dimensionId: string,
  rawValue: Cell
): Cell => {
  if (rawValue === null || rawValue === undefined) return rawValue;

  const valueSource = ctx.valueSourceByDimension[dimensionId];
  if (!valueSource) return rawValue;

  const raw = String(rawValue);

  if (raw === NONE_SENTINEL) {
    return ctx.sentinels.noneByValueSource[valueSource] ?? ctx.sentinels.noneDefault;
  }
  if (raw === OTHER_SENTINEL) return ctx.sentinels.other;

  const name = ctx.maps[valueSource]?.[raw];

  // Products are keyed by variant SKU. When a name resolves, show "<name> (<sku>)" so the SKU
  // (the canonical key the operator may search by) stays visible; otherwise show the raw SKU.
  if (valueSource === 'ct-products') {
    return name ? `${name} (${raw})` : rawValue;
  }

  return name ?? rawValue;
};

/**
 * Build the Merchant Center deep link for a dimension cell, or `undefined` when the value is
 * not linkable: a non-CT dimension, a sentinel, a source with no per-entity MC page
 * (channels / customer groups), a value whose id has not resolved, or a missing project key.
 *
 * The href is a same-origin absolute path (`/<projectKey>/<route>/<id>`) so it opens the MC
 * entity page in a new tab without the reporting app needing to know the MC host.
 */
export const resolveDimensionHref = (
  ctx: DimensionLabelContext,
  projectKey: string,
  dimensionId: string,
  rawValue: Cell
): string | undefined => {
  if (rawValue === null || rawValue === undefined) return undefined;
  if (!projectKey) return undefined;

  const valueSource = ctx.valueSourceByDimension[dimensionId];
  if (!valueSource) return undefined;

  const route = DEEP_LINK_ROUTE[valueSource];
  if (!route) return undefined;

  const raw = String(rawValue);
  if (raw === NONE_SENTINEL || raw === OTHER_SENTINEL) return undefined;

  const id = ctx.idMaps?.[valueSource]?.[raw];
  if (!id) return undefined;

  return `/${projectKey}/${route}/${id}`;
};

/**
 * Resolve a raw dimension cell to its display label and, when available, a deep-link href.
 * The one call a table cell renderer needs: it keeps the canonical key in the data model and
 * only shapes what is displayed and where it links.
 */
export const resolveDimensionCell = (
  ctx: DimensionLabelContext,
  projectKey: string,
  dimensionId: string,
  rawValue: Cell
): ResolvedCell => {
  const resolved = resolveDimensionValue(ctx, dimensionId, rawValue);
  const label =
    resolved === null || resolved === undefined ? '' : String(resolved);
  const href = resolveDimensionHref(ctx, projectKey, dimensionId, rawValue);
  return href ? { label, href } : { label };
};

/**
 * Return a copy of `row` with every CT-resolvable dimension cell replaced by its display
 * label. Rows with no resolvable change are returned by reference, so React re-renders stay
 * cheap. Metric and time cells are never touched.
 */
export const resolveRow = (
  ctx: DimensionLabelContext,
  columns: ColumnMeta[],
  row: Row
): Row => {
  let next: Row = row;
  for (const column of columns) {
    if (column.role !== 'dimension') continue;
    if (!ctx.valueSourceByDimension[column.id]) continue;
    const resolved = resolveDimensionValue(ctx, column.id, row[column.id]);
    if (resolved !== row[column.id]) {
      if (next === row) next = { ...row };
      next[column.id] = resolved;
    }
  }
  return next;
};
