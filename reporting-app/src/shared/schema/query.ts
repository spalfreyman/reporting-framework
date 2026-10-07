import { z } from 'zod';
import { GRAINS } from '../semantic/types';

/**
 * The query protocol between the gateway and every data source.
 *
 * Responses are TIDY LONG FORMAT with typed column metadata, which is what lets one
 * contract carry any shape of data — time series, breakdowns, cohort matrices, pivots.
 */

export const grainSchema = z.enum(GRAINS);

export const valueTypeSchema = z.enum([
  'money',
  'count',
  'ratio',
  'percent',
  'duration_s',
  'string',
  'bool',
  'time',
]);

export const filterSchema = z.union([
  z.object({
    dimension: z.string(),
    op: z.enum(['in', 'notIn']),
    values: z.array(z.union([z.string(), z.number()])),
  }),
  z.object({
    dimension: z.string(),
    op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains']),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    dimension: z.string(),
    op: z.literal('between'),
    from: z.union([z.string(), z.number()]),
    to: z.union([z.string(), z.number()]),
  }),
]);
export type Filter = z.infer<typeof filterSchema>;

/**
 * Row-level scope. Derived SERVER-SIDE from the verified JWT on every request and never
 * accepted from the client. A source must INTERSECT this — it can narrow, never widen.
 */
export const rowScopeSchema = z.object({
  stores: z.array(z.string()).optional(),
  businessUnits: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  /** True when the subject is unrestricted; lets a source skip scope work entirely. */
  unrestricted: z.boolean().default(false),
});
export type RowScope = z.infer<typeof rowScopeSchema>;

/** Half-open [from, to). Every off-by-one-day bug comes from inclusive upper bounds. */
export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
});
export type DateRange = z.infer<typeof dateRangeSchema>;

export const sourceQuerySchema = z.object({
  protocolVersion: z.literal(1),
  requestId: z.string().min(1),
  projectKey: z.string().min(1),
  /** BASE metrics only — sources never see formulas. */
  metrics: z.array(z.string()).min(1),
  dimensions: z.array(z.string()).default([]),
  grain: grainSchema.nullable().default(null),
  timeRange: dateRangeSchema.optional(),
  /** IANA timezone the day buckets must be cut in. Load-bearing for cross-source joins. */
  timezone: z.string().default('UTC'),
  compareTo: dateRangeSchema.optional(),
  /** Point-in-time query (live catalogue snapshots). Mutually exclusive with timeRange. */
  asOf: z.string().optional(),
  filters: z.array(filterSchema).default([]),
  scope: rowScopeSchema,
  orderBy: z
    .array(z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }))
    .default([]),
  limit: z.number().int().positive().max(50000).default(1000),
  cursor: z.string().optional(),
  budgetMs: z.number().int().positive().default(25000),
});
export type SourceQuery = z.infer<typeof sourceQuerySchema>;

export const columnMetaSchema = z.object({
  id: z.string(),
  role: z.enum(['dimension', 'metric', 'time']),
  valueType: valueTypeSchema,
  /** Present when the column is money AND resolves to a single currency. */
  currencyCode: z.string().optional(),
  fractionDigits: z.number().int().optional(),
  exactness: z.enum(['exact', 'sampled', 'estimated']).default('exact'),
  /** null means "unknown" vs "genuinely none" — changes how a gap renders. */
  nullMeaning: z.enum(['zero', 'unknown']).default('zero'),
});
export type ColumnMeta = z.infer<typeof columnMetaSchema>;

export const degradedReasonSchema = z.enum([
  'range-clamped',
  'grain-coarsened',
  'quota-exhausted',
  'source-unavailable',
  'limit-truncated',
  'facet-term-cap',
  'demo-fixture',
  'timezone-mismatch',
]);
export type DegradedReason = z.infer<typeof degradedReasonSchema>;

export const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const resultSetSchema = z.object({
  protocolVersion: z.literal(1),
  sourceId: z.string(),
  columns: z.array(columnMetaSchema),
  /** Row-major; cell order matches `columns` order. */
  rows: z.array(z.array(cellSchema)),
  rowCount: z.number().int().nonnegative(),
  cursor: z.string().optional(),
  status: z.enum(['ok', 'partial', 'degraded', 'empty']),
  flags: z
    .object({
      partial: z.boolean().default(false),
      degradedReason: degradedReasonSchema.optional(),
      detail: z.string().optional(),
      rowsTruncated: z.number().int().optional(),
      /** Grain actually served; may be coarser than requested. */
      grainServed: grainSchema.nullable().default(null),
    })
    .default({ partial: false, grainServed: null }),
  provenance: z.object({
    sourceId: z.string(),
    connectorVersion: z.string(),
    execution: z.enum(['live', 'materialized']),
    /** Watermark: newest event included. The tile stamps this. */
    dataAsOf: z.string(),
    freshnessLagSeconds: z.number().int().nonnegative(),
    cacheHit: z.boolean().default(false),
    /** e.g. GA4 API calls consumed, for quota accounting. */
    upstreamRequests: z.number().int().nonnegative().default(0),
  }),
  cacheHints: z
    .object({
      ttlSeconds: z.number().int().nonnegative(),
      staleWhileRevalidateSeconds: z.number().int().nonnegative().default(0),
    })
    .default({ ttlSeconds: 300, staleWhileRevalidateSeconds: 0 }),
});
export type ResultSet = z.infer<typeof resultSetSchema>;

export const DSP_ERROR_CODES = [
  'UNSUPPORTED_METRIC',
  'UNSUPPORTED_DIMENSION',
  'UNSUPPORTED_GRAIN',
  'RANGE_BELOW_FLOOR',
  'RANGE_ABOVE_CEILING',
  'FILTER_REQUIRED',
  'SCOPE_UNSATISFIABLE',
  'QUOTA_EXCEEDED',
  'BUDGET_EXCEEDED',
  'TOO_MANY_ROWS',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_AUTH',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'CAPABILITY_NOT_IMPLEMENTED',
  'INTERNAL',
] as const;
export type DspErrorCode = (typeof DSP_ERROR_CODES)[number];

export const dspErrorSchema = z.object({
  code: z.enum(DSP_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().optional(),
  sourceId: z.string(),
  requestId: z.string(),
});
export type DspError = z.infer<typeof dspErrorSchema>;

/**
 * Capability errors mean the planner should have prevented the call — which in practice
 * means the gateway's cached descriptor is stale. Invalidate, refetch, replan once.
 * Never retry blindly.
 */
export const CAPABILITY_ERROR_CODES: readonly DspErrorCode[] = [
  'UNSUPPORTED_METRIC',
  'UNSUPPORTED_DIMENSION',
  'UNSUPPORTED_GRAIN',
  'RANGE_BELOW_FLOOR',
  'RANGE_ABOVE_CEILING',
  'FILTER_REQUIRED',
];

export const isCapabilityError = (code: DspErrorCode): boolean =>
  CAPABILITY_ERROR_CODES.includes(code);
