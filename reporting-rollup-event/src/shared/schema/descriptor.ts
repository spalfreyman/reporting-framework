import { z } from 'zod';
import { grainSchema } from './query.js';

/**
 * The capability descriptor: what makes the framework DISCOVER capability rather than
 * assume it.
 *
 * Each data-source connector's postDeploy idempotently upserts its descriptor into
 * Custom Object container `reporting.datasources`, key = sourceId. The gateway lists that
 * container to build its registry. Installing a connector therefore extends the framework
 * with no framework redeploy; uninstalling degrades affected reports instead of breaking
 * them.
 */

export const sourceKindSchema = z.enum([
  'commerce',
  'web-analytics',
  'erp',
  'oms',
  'warehouse',
  'custom',
]);

export const metricCapabilitySchema = z.object({
  metricId: z.string(),
  execution: z.enum(['live', 'materialized']),
  grains: z.array(grainSchema),
  /** Dimensions this specific metric can be split by. */
  dimensions: z.array(z.string()),
  /** Metric-level override of the source-level date floor. */
  dateFloor: z.string().optional(),
  costClass: z.enum(['cheap', 'moderate', 'expensive']).default('cheap'),
  exactness: z.enum(['exact', 'sampled', 'estimated']).default('exact'),
});
export type MetricCapability = z.infer<typeof metricCapabilitySchema>;

export const dimensionCapabilitySchema = z.object({
  dimensionId: z.string(),
  /**
   * Must equal the registry's DimensionDef.canonicalKeyDefinition for this dimension to
   * be join-eligible across sources. The gateway compares literally.
   */
  canonicalKeyDefinition: z.string().optional(),
  filterable: z.boolean().default(true),
  maxCardinality: z.number().int().optional(),
});
export type DimensionCapability = z.infer<typeof dimensionCapabilitySchema>;

export const dataSourceDescriptorSchema = z.object({
  descriptorVersion: z.literal(1),
  protocolVersion: z.literal(1),
  /** Unique per installation. */
  sourceId: z.string().min(1).regex(/^[a-z0-9-]+$/),
  labelKey: z.string(),
  displayName: z.string(),
  kind: sourceKindSchema,
  connector: z.object({ name: z.string(), version: z.string() }),
  /** HTTPS. Written by the connector's own postDeploy from Connect's injected URL. */
  endpointUrl: z.string().url(),
  authMode: z.enum(['shared-secret', 'connect-service-oauth']).default('shared-secret'),
  /** True when serving fixtures rather than a live upstream. Surfaced in the UI. */
  demoMode: z.boolean().default(false),

  capabilities: z.object({
    metrics: z.array(metricCapabilitySchema),
    dimensions: z.array(dimensionCapabilitySchema),
    grains: z.array(grainSchema),
    /** Absolute ISO date, or a relative ISO-8601 duration like '-P90D'. */
    dateFloor: z.string().optional(),
    /** e.g. '-P1D' for a T-1 warehouse. */
    dateCeiling: z.string().optional(),
    /**
     * The IANA timezone this source cuts its day buckets in. LOAD BEARING: commercetools
     * is UTC, a GA4 property has its own. At day grain those buckets do not line up, and
     * joining them silently produces numbers that are quietly wrong at day boundaries.
     */
    timezone: z.string().default('UTC'),
    maxRowsPerResponse: z.number().int().positive().default(10000),
    supportsPagination: z.boolean().default(false),
    supportsCompare: z.boolean().default(false),
    supportsDimensionValues: z.boolean().default(false),
    /** Dimensions that MUST be filtered for a query to be answerable at all. */
    requiresFilters: z.array(z.string()).default([]),
  }),

  freshness: z.object({
    mode: z.enum(['live', 'materialized']),
    updateFrequency: z.enum(['realtime', 'near-realtime', 'minutes', 'hourly', 'daily', 'on-demand']),
    typicalLagSeconds: z.number().int().nonnegative(),
    maxLagSeconds: z.number().int().nonnegative(),
    /** How far back numbers can still change. Drives the sealed/hot cache boundary. */
    restatementWindowDays: z.number().int().nonnegative().default(0),
    recommendedCacheTtlSeconds: z.number().int().nonnegative().default(300),
  }),

  /**
   * Row-level scope dimensions this source can enforce ITSELF.
   *
   * Fail closed: a source that does not list the scope dimension cannot be used at all
   * for a scoped subject. You cannot post-filter GA4 aggregates down to one store if GA4
   * cannot split by store — pretending otherwise yields a number that looks
   * store-specific and is not.
   */
  scoping: z.object({
    rowLevelDimensions: z.array(z.string()).default([]),
  }),

  provenance: z.object({
    /** True when this source is the system of record for its metrics. */
    systemOfRecord: z.boolean().default(false),
    /** Final deterministic tiebreak in source selection. Higher wins. */
    authorityRank: z.number().int().default(0),
  }),

  quota: z
    .object({
      kind: z.enum(['token-bucket', 'rps', 'none']),
      concurrency: z.number().int().positive().default(4),
      note: z.string().optional(),
    })
    .optional(),

  registeredAt: z.string(),
});
export type DataSourceDescriptor = z.infer<typeof dataSourceDescriptorSchema>;

/** Custom Object containers and keys, in one place so nothing drifts. */
export const CO = {
  datasources: 'reporting.datasources',
  config: 'reporting.config',
  reports: 'reporting.reports',
  accessPolicy: 'reporting.access-policy',
  subjectScope: 'reporting.subject-scope',
  locks: 'reporting.locks',
  cursors: 'reporting.cursors',
  dirtyDays: 'reporting.dirty-days',
  audit: 'reporting.audit',
  /** Per-order facts, sharded by month: reporting.order-facts-2026-08 */
  orderFactsPrefix: 'reporting.order-facts-',
  /** Day-partitioned fact tables: reporting.facts.orders-daily */
  factPrefix: 'reporting.facts.',
  keys: {
    gateway: 'gateway',
    cubes: 'cubes',
    sourcePriority: 'source-priority',
    epoch: 'epoch',
    rollupWatermark: 'rollup-watermark',
  },
} as const;

export const orderFactsContainer = (yyyyMm: string): string =>
  `${CO.orderFactsPrefix}${yyyyMm}`;

export const factContainer = (cube: string): string => `${CO.factPrefix}${cube}`;
