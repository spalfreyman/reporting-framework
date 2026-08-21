import type { DataSourceDescriptor, MetricCapability } from './shared/schema/descriptor.js';
import { readConfiguration } from './env.js';

export const CONNECTOR_VERSION = '0.1.0';

/**
 * The warehouse is the SCALE tier. It serves the things that push a rollup off the Custom
 * Object tier — SKU- and customer-grain metrics — plus the data commercetools does not hold
 * at all: unit cost (feeding gross margin) and marketing spend (feeding ROAS/CAC).
 *
 * It advertises product-grain revenue/units so the planner can prefer it over ct-native's
 * top-N-capped rollup when a report genuinely needs the full catalogue.
 */

const metric = (metricId: string, dimensions: string[]): MetricCapability => ({
  metricId,
  execution: 'materialized',
  grains: ['day', 'week', 'month', 'quarter', 'year'],
  dimensions,
  costClass: 'moderate',
  exactness: 'exact',
});

const CONFORMED = [
  { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
  { dimensionId: 'currency', canonicalKeyDefinition: 'iso-4217', filterable: true },
  { dimensionId: 'store', canonicalKeyDefinition: 'commercetools:store.key', filterable: true },
  { dimensionId: 'category', canonicalKeyDefinition: 'commercetools:category.key', filterable: true },
  { dimensionId: 'product', canonicalKeyDefinition: 'commercetools:variant.sku', filterable: true, maxCardinality: 1_000_000 },
  { dimensionId: 'campaign', filterable: true },
  { dimensionId: 'channel', filterable: true },
];

export const buildDescriptor = (): DataSourceDescriptor => {
  const config = readConfiguration();
  const endpointUrl = (config.CONNECT_SERVICE_URL ?? `http://localhost:${config.PORT}`).replace(/\/$/, '');

  return {
    descriptorVersion: 1,
    protocolVersion: 1,
    sourceId: config.SOURCE_ID,
    labelKey: 'source.warehouse',
    displayName: config.SOURCE_DISPLAY_NAME,
    kind: 'warehouse',
    connector: { name: 'warehouse-source', version: CONNECTOR_VERSION },
    endpointUrl,
    authMode: 'shared-secret',
    demoMode: config.MODE === 'demo',
    capabilities: {
      metrics: [
        metric('cost.goods@orderdate', ['currency', 'store', 'category', 'product']),
        metric('revenue.net@orderdate', ['currency', 'store', 'category', 'product']),
        metric('units.sold@orderdate', ['currency', 'store', 'category', 'product']),
        metric('marketing.spend', ['currency', 'campaign', 'channel']),
      ],
      dimensions: CONFORMED,
      grains: ['day', 'week', 'month', 'quarter', 'year'],
      timezone: config.WAREHOUSE_TIMEZONE,
      maxRowsPerResponse: config.MAX_ROWS,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: false,
      requiresFilters: [],
    },
    freshness: {
      mode: 'materialized',
      updateFrequency: 'daily',
      typicalLagSeconds: 24 * 3600, // typically a nightly ETL
      maxLagSeconds: 48 * 3600,
      restatementWindowDays: 7,
      recommendedCacheTtlSeconds: 3600,
    },
    // A warehouse table keyed on store CAN enforce store scope.
    scoping: { rowLevelDimensions: ['store'] },
    provenance: { systemOfRecord: false, authorityRank: 40 },
    quota: { kind: 'none', concurrency: 4 },
    registeredAt: new Date().toISOString(),
  };
};
