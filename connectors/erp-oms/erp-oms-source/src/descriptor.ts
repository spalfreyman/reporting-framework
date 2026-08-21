import type { DataSourceDescriptor, MetricCapability } from './shared/schema/descriptor.js';
import { readConfiguration } from './env.js';

export const CONNECTOR_VERSION = '0.1.0';

/**
 * The ERP/OMS source: supply-chain and fulfilment truth that lives outside commercetools —
 * on-hand stock, weeks of cover, unit cost, dispatch SLA, return reasons.
 *
 * Freshness is honestly daily: these come from a nightly extract, not live per request,
 * because ERP APIs are slow and rate-limited. The descriptor says so, so the UI can stamp
 * "ERP data current to 03:10" rather than implying real-time.
 */

const metric = (metricId: string, dimensions: string[], grains: MetricCapability['grains']): MetricCapability => ({
  metricId,
  execution: 'materialized',
  grains,
  dimensions,
  costClass: 'moderate',
  exactness: 'exact',
});

const DAILY = ['day', 'week', 'month', 'quarter', 'year'] as const;

export const buildDescriptor = (): DataSourceDescriptor => {
  const config = readConfiguration();
  const endpointUrl = (config.CONNECT_SERVICE_URL ?? `http://localhost:${config.PORT}`).replace(/\/$/, '');

  return {
    descriptorVersion: 1,
    protocolVersion: 1,
    sourceId: config.SOURCE_ID,
    labelKey: 'source.erpOms',
    displayName: config.SOURCE_DISPLAY_NAME,
    kind: 'erp',
    connector: { name: 'erp-oms-source', version: CONNECTOR_VERSION },
    endpointUrl,
    authMode: 'shared-secret',
    demoMode: config.MODE === 'demo',
    capabilities: {
      metrics: [
        // Inventory is a point-in-time snapshot → no time grain.
        metric('inventory.available', ['warehouse', 'product'], []),
        metric('shipments.count', ['warehouse', 'carrier'], [...DAILY]),
        metric('shipments.onTime', ['warehouse', 'carrier'], [...DAILY]),
        metric('fulfilment.pickToShipSeconds', ['warehouse'], [...DAILY]),
        metric('returns.units@orderdate', ['returnReason'], [...DAILY]),
      ],
      dimensions: [
        { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
        { dimensionId: 'product', canonicalKeyDefinition: 'commercetools:variant.sku', filterable: true, maxCardinality: 1_000_000 },
        { dimensionId: 'warehouse', filterable: true },
        { dimensionId: 'carrier', filterable: true },
        { dimensionId: 'returnReason', filterable: true },
      ],
      grains: [...DAILY],
      timezone: config.ERP_TIMEZONE,
      maxRowsPerResponse: 50_000,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: false,
      requiresFilters: [],
    },
    freshness: {
      mode: 'materialized',
      updateFrequency: 'daily',
      typicalLagSeconds: 24 * 3600,
      maxLagSeconds: 48 * 3600,
      restatementWindowDays: 14, // returns and adjustments trickle in
      recommendedCacheTtlSeconds: 3600,
    },
    scoping: { rowLevelDimensions: ['warehouse'] },
    provenance: { systemOfRecord: true, authorityRank: 60 },
    quota: { kind: 'none', concurrency: 2 },
    registeredAt: new Date().toISOString(),
  };
};
