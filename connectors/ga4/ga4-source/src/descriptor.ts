import type { DataSourceDescriptor, MetricCapability } from './shared/schema/descriptor.js';
import { readConfiguration } from './env.js';

export const CONNECTOR_VERSION = '0.1.0';

/**
 * What GA4 can serve.
 *
 * Web-analytics metrics only — sessions, users, the funnel steps, search. Crucially NONE of
 * these are the order/revenue truth: commercetools owns that. GA4 supplies the upper funnel,
 * and the gateway combines the two into cross-source metrics like conversion rate.
 *
 * Everything is marked `sampled`, because GA4 figures are modelled (consent mode, thresholds,
 * bot filtering) and must never sit next to an exact commercetools figure without a marker.
 */

/** GA4 dimensions this source can split by, with their conformance keys. */
const DIMENSIONS = [
  // `date`, `country` and `device` are conformed — they can join to commercetools.
  { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
  { dimensionId: 'country', canonicalKeyDefinition: 'iso-3166-1-alpha2', filterable: true },
  {
    dimensionId: 'device',
    canonicalKeyDefinition: 'device-category:desktop|mobile|tablet',
    filterable: true,
  },
  // Web-only, deliberately NOT conformed with any commercetools dimension.
  { dimensionId: 'trafficChannel', filterable: true },
  { dimensionId: 'sourceMedium', filterable: true },
  { dimensionId: 'campaign', filterable: true },
  { dimensionId: 'landingPage', filterable: true },
  { dimensionId: 'searchTerm', filterable: true },
];

const SPLITTABLE = DIMENSIONS.map((d) => d.dimensionId);

const metric = (metricId: string): MetricCapability => ({
  metricId,
  execution: 'live',
  grains: ['day', 'week', 'month', 'quarter', 'year'],
  dimensions: SPLITTABLE,
  costClass: 'expensive', // each live call spends the property's shared token budget
  exactness: 'sampled',
});

export const buildDescriptor = (): DataSourceDescriptor => {
  const config = readConfiguration();
  const endpointUrl = (config.CONNECT_SERVICE_URL ?? `http://localhost:${config.PORT}`).replace(
    /\/$/,
    ''
  );

  return {
    descriptorVersion: 1,
    protocolVersion: 1,
    sourceId: config.SOURCE_ID,
    labelKey: 'source.ga4',
    displayName: config.SOURCE_DISPLAY_NAME,
    kind: 'web-analytics',
    connector: { name: 'ga4-source', version: CONNECTOR_VERSION },
    endpointUrl,
    authMode: 'shared-secret',
    demoMode: config.MODE === 'demo',

    capabilities: {
      metrics: [
        metric('sessions.count'),
        metric('users.active'),
        metric('pageviews.count'),
        metric('productviews.count'),
        metric('addtocart.count'),
        metric('checkoutstart.count'),
        metric('searches.count'),
        metric('searches.zeroResult'),
      ],
      dimensions: DIMENSIONS,
      grains: ['day', 'week', 'month', 'quarter', 'year'],
      timezone: config.GA4_TIMEZONE,
      maxRowsPerResponse: 100_000,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: true,
      requiresFilters: [],
    },

    freshness: {
      mode: 'live',
      updateFrequency: 'daily',
      // GA4 finalises a day's figures with a lag; treat "today" as provisional.
      typicalLagSeconds: 6 * 3600,
      maxLagSeconds: 48 * 3600,
      // GA4 keeps re-attributing recent days; a short restatement window drives caching.
      restatementWindowDays: 3,
      recommendedCacheTtlSeconds: config.CACHE_TTL_TODAY_SECONDS,
    },

    // GA4 cannot restrict rows to a commercetools store/business-unit, so it must NOT be used
    // for a subject scoped by those — the gateway fails that closed rather than returning
    // figures that look store-specific and are not.
    scoping: { rowLevelDimensions: [] },

    provenance: { systemOfRecord: false, authorityRank: 20 },
    quota: {
      kind: 'token-bucket',
      concurrency: 4,
      note: 'GA4 Data API tokens are per-property and shared by every consumer.',
    },
    registeredAt: new Date().toISOString(),
  };
};
