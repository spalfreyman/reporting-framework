import type { DataSourceDescriptor, MetricCapability } from './shared/schema/descriptor.js';
import { readConfiguration } from './env.js';

export const CONNECTOR_VERSION = '0.1.0';

/**
 * What this source can serve.
 *
 * Two distinct execution modes in one connector, because commercetools genuinely has both:
 *
 *  - LIVE: Product Search supports count / ranges / stats facets, so catalogue, price and
 *    inventory reporting needs no materialization at all and is always current.
 *  - MATERIALIZED: there is NO aggregation API for orders — Order Search indexes only three
 *    months, returns IDs only and does no aggregation — so every order-grain metric is read
 *    from the day-partitioned rollup fact store instead.
 *
 * Declaring both honestly is what lets the planner choose correctly per metric.
 */

const ORDER_DIMENSIONS = [
  'date',
  'currency',
  'store',
  'distributionChannel',
  'country',
  'orderState',
  'paymentState',
  'customerGroup',
  'customerType',
];

const ITEM_DIMENSIONS = ['date', 'currency', 'store', 'product', 'category'];

const materialized = (metricId: string, dimensions: string[]): MetricCapability => ({
  metricId,
  execution: 'materialized',
  grains: ['day', 'week', 'month', 'quarter', 'year'],
  dimensions,
  costClass: 'cheap',
  exactness: 'exact',
});

/** Live facets are a point-in-time snapshot, so they have no time grain at all. */
const live = (metricId: string, dimensions: string[]): MetricCapability => ({
  metricId,
  execution: 'live',
  grains: [],
  dimensions,
  costClass: 'cheap',
  exactness: 'exact',
  // Product Search facets are current to the request. Declared per-metric so these live metrics
  // are NOT judged by the source-level maxLag (which describes the order rollup's lag): without
  // this, a near-real-time catalogue report rejects ct-native because the rollup lags an hour.
  maxLagSeconds: 60,
  typicalLagSeconds: 0,
});

export interface DescriptorOptions {
  /**
   * Whether Product Search is usable on this project. When false, the six live catalogue
   * metrics are omitted entirely — the framework's contract is that a source advertises only
   * what it can actually serve, so the planner simply routes catalogue reports elsewhere (or
   * marks them unavailable) rather than failing per tile.
   */
  productSearchAvailable?: boolean;
}

export const buildDescriptor = (options: DescriptorOptions = {}): DataSourceDescriptor => {
  const config = readConfiguration();
  // Demo mode serves catalogue fixtures, so Product Search availability is irrelevant there.
  const liveCatalogue = config.MODE === 'demo' || options.productSearchAvailable !== false;
  const endpointUrl = (
    config.CONNECT_SERVICE_URL ?? `http://localhost:${config.PORT}`
  ).replace(/\/$/, '');

  return {
    descriptorVersion: 1,
    protocolVersion: 1,
    sourceId: config.SOURCE_ID,
    labelKey: 'source.ctNative',
    displayName: config.SOURCE_DISPLAY_NAME,
    kind: 'commerce',
    connector: { name: 'ct-native-source', version: CONNECTOR_VERSION },
    endpointUrl,
    authMode: 'shared-secret',
    demoMode: config.MODE === 'demo',

    capabilities: {
      metrics: [
        // ── Order grain, from the rollup fact store ──────────────────────────
        materialized('orders.count@orderdate', ORDER_DIMENSIONS),
        materialized('revenue.gross@orderdate', ORDER_DIMENSIONS),
        // Net revenue is also served at item grain: by product from order-lines-daily, by
        // category from order-categories-daily. (Gross/discount/tax are order-level only, so
        // they stay order-grain.) Item-grain net is line revenue, which need not reconcile to
        // the penny with order-grain net — order-level discounts/shipping live on the order.
        materialized('revenue.net@orderdate', [...ORDER_DIMENSIONS, 'product', 'category']),
        materialized('revenue.net@cashdate', ORDER_DIMENSIONS),
        materialized('discount.value@orderdate', ORDER_DIMENSIONS),
        materialized('shipping.revenue@orderdate', ORDER_DIMENSIONS),
        materialized('tax.collected@orderdate', ORDER_DIMENSIONS),
        materialized('units.sold@orderdate', [...ORDER_DIMENSIONS, 'product', 'category']),
        // Cost of goods is item-grain only (per product/category), from the line item price's
        // `cost` custom field captured at order time. Drives margin.gross@orderdate (a derived
        // metric = revenue.net - cost.goods, evaluated by the gateway after aggregation).
        materialized('cost.goods@orderdate', ['date', 'currency', 'store', 'product', 'category']),
        materialized('lines.count@orderdate', ORDER_DIMENSIONS),
        materialized('refunds.value@cashdate', ORDER_DIMENSIONS),
        materialized('returns.units@orderdate', [...ITEM_DIMENSIONS, 'returnReason']),
        materialized('customers.new@orderdate', ORDER_DIMENSIONS),
        materialized('customers.active@orderdate', ORDER_DIMENSIONS),
        materialized('orders.promoted@orderdate', [...ORDER_DIMENSIONS, 'discountCode']),
        materialized('discount.redemptions', ['date', 'discountCode', 'store', 'currency']),
        // cohortSize carries periodIndex too: the snapshot repeats the cohort total on every
        // period row so retention.rate (retained/cohortSize) can be grouped by (cohortMonth,
        // periodIndex) in the heatmap.
        materialized('customers.cohortSize', ['cohortMonth', 'periodIndex', 'store']),
        materialized('customers.retained', ['cohortMonth', 'periodIndex', 'store']),
        materialized('shipments.count', ['date', 'store', 'shippingMethod', 'carrier']),
        materialized('shipments.onTime', ['date', 'store', 'shippingMethod', 'carrier']),

        // ── Live stock, from the InventoryEntry API ──────────────────────────
        // Served from the core InventoryEntry resource (NOT Product Search), so it is
        // advertised even where Product Search is not activated. Grain is supplyChannel (the
        // native stock location) / product (SKU) / category — never `store`, because a supply
        // channel can belong to several stores and a store breakdown would double-count stock.
        live('inventory.available', ['category', 'product', 'supplyChannel']),

        // ── Live promotions, from the CartDiscount / DiscountCode API ─────────
        // Served from the core discount APIs (no Product Search), so promotion-effectiveness can
        // list every active promotion keyed by discountCode and outer-join it with redemptions.
        live('promotions.active', ['discountCode', 'store', 'currency']),

        // ── Live catalogue, from Product Search facets ───────────────────────
        // Advertised only when Product Search is actually available on the project.
        ...(liveCatalogue
          ? [
              live('products.count', ['category', 'productType', 'brand', 'priceBand', 'currency']),
              live('variants.count', ['category', 'productType', 'brand', 'currency']),
              live('price.min', ['category', 'productType', 'brand', 'currency']),
              live('price.max', ['category', 'productType', 'brand', 'currency']),
              live('price.mean', ['category', 'productType', 'brand', 'currency']),
            ]
          : []),
      ],

      dimensions: [
        // canonicalKeyDefinition must match the registry EXACTLY for a dimension to be
        // usable as a cross-source join key. Anything omitted here is single-source only.
        { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
        { dimensionId: 'currency', canonicalKeyDefinition: 'iso-4217', filterable: true },
        { dimensionId: 'country', canonicalKeyDefinition: 'iso-3166-1-alpha2', filterable: true },
        { dimensionId: 'store', canonicalKeyDefinition: 'commercetools:store.key', filterable: true },
        {
          dimensionId: 'product',
          canonicalKeyDefinition: 'commercetools:variant.sku',
          filterable: true,
          maxCardinality: 100_000,
        },
        {
          dimensionId: 'category',
          canonicalKeyDefinition: 'commercetools:category.key',
          filterable: true,
        },
        { dimensionId: 'distributionChannel', filterable: true },
        {
          dimensionId: 'supplyChannel',
          canonicalKeyDefinition: 'commercetools:channel.key',
          filterable: true,
        },
        { dimensionId: 'orderState', filterable: true },
        { dimensionId: 'paymentState', filterable: true },
        { dimensionId: 'customerGroup', filterable: true },
        { dimensionId: 'customerType', filterable: true },
        { dimensionId: 'productType', filterable: true },
        { dimensionId: 'brand', filterable: true },
        { dimensionId: 'priceBand', filterable: true },
        { dimensionId: 'discountCode', filterable: true },
        { dimensionId: 'returnReason', filterable: true },
        { dimensionId: 'shippingMethod', filterable: true },
        { dimensionId: 'carrier', filterable: true },
        { dimensionId: 'cohortMonth', filterable: false },
        { dimensionId: 'periodIndex', filterable: false },
      ],

      grains: ['day', 'week', 'month', 'quarter', 'year'],
      timezone: config.ROLLUP_TIMEZONE,
      maxRowsPerResponse: 20_000,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: true,
      /**
       * Product Search `stats` facets on a money field return a bare number with no
       * currency, so a live price query is only meaningful once a single currency is pinned.
       * Declaring it here means the planner never issues an ambiguous query.
       */
      requiresFilters: [],
    },

    freshness: {
      mode: 'materialized',
      updateFrequency: 'minutes',
      // The rollup event handler writes order facts within seconds; the fold job promotes
      // them into day partitions every ten minutes. That fold interval is the honest lag.
      typicalLagSeconds: 600,
      maxLagSeconds: 3600,
      // A refund or return can restate a day up to this far back, which is what sets the
      // gateway's sealed/hot cache boundary.
      restatementWindowDays: 90,
      recommendedCacheTtlSeconds: 300,
    },

    scoping: {
      // Both are materialised as rollup keys precisely so a scoped subject can be served.
      rowLevelDimensions: ['store', 'distributionChannel', 'country'],
    },

    provenance: { systemOfRecord: true, authorityRank: 100 },
    quota: { kind: 'none', concurrency: 8 },
    registeredAt: new Date().toISOString(),
  };
};
