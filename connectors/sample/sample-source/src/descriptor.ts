import type { DataSourceDescriptor, MetricCapability } from './shared/schema/descriptor.js';
import { readConfiguration } from './env.js';

export const CONNECTOR_VERSION = '0.1.0';

/**
 * What this source can serve.
 *
 * The descriptor is the whole basis of discovery: the gateway lists Custom Object container
 * `reporting.datasources` and plans against exactly what each source declares here. Declare
 * only metrics/dimensions/grains you actually answer in handler.ts — the DSP harness
 * validates every request against this and rejects anything you did not promise.
 *
 * These sample metric ids are namespaced (`sample.*`) so they never collide with the
 * framework's semantic registry. A real connector maps to the shared semantic metric ids
 * (e.g. `sessions.count`) so its figures conform and can join across sources.
 */

/** Dimensions this source can split by. `date` is conformed; the rest are source-local. */
const DIMENSIONS = [
  { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
  { dimensionId: 'channel', filterable: true },
  { dimensionId: 'region', filterable: true },
];

const SPLITTABLE = DIMENSIONS.map((d) => d.dimensionId);
const GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;

const metric = (metricId: string): MetricCapability => ({
  metricId,
  execution: 'materialized',
  grains: [...GRAINS],
  dimensions: SPLITTABLE,
  costClass: 'cheap',
  exactness: 'exact',
});

/** The metrics this sample serves. Keep this list in sync with generateRows() in data.ts. */
export const SAMPLE_METRICS = [
  'sample.visits',
  'sample.signups',
  'sample.events',
];

export const buildDescriptor = (): DataSourceDescriptor => {
  const config = readConfiguration();
  // postDeploy injects CONNECT_SERVICE_URL (already includes this app's mount path); fall
  // back to localhost for local dev. The gateway calls `<endpointUrl>/query`.
  const endpointUrl = (config.CONNECT_SERVICE_URL ?? `http://localhost:${config.PORT}`).replace(
    /\/$/,
    ''
  );

  return {
    descriptorVersion: 1,
    protocolVersion: 1,
    sourceId: config.SOURCE_ID,
    labelKey: 'source.sample',
    displayName: config.SOURCE_DISPLAY_NAME,
    kind: 'custom',
    connector: { name: 'sample-source', version: CONNECTOR_VERSION },
    endpointUrl,
    authMode: 'shared-secret',
    // Synthetic data is not a live upstream, so it is honestly a demo/fixture source.
    demoMode: true,

    capabilities: {
      metrics: SAMPLE_METRICS.map(metric),
      dimensions: DIMENSIONS,
      grains: [...GRAINS],
      timezone: config.SOURCE_TIMEZONE,
      maxRowsPerResponse: 50_000,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: true,
      requiresFilters: [],
    },

    freshness: {
      mode: 'materialized',
      updateFrequency: 'daily',
      typicalLagSeconds: 0,
      maxLagSeconds: 0,
      restatementWindowDays: 0,
      recommendedCacheTtlSeconds: 300,
    },

    // This sample cannot restrict rows to a commercetools store/business-unit, so it declares
    // no row-level scope dimensions; the gateway fails a scoped subject closed rather than
    // handing back figures that look scoped and are not.
    scoping: { rowLevelDimensions: [] },

    provenance: { systemOfRecord: false, authorityRank: 0 },
    registeredAt: new Date().toISOString(),
  };
};
