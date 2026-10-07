import { timingSafeEqual } from 'node:crypto';
import {
  sourceQuerySchema,
  type DspErrorCode,
  type ResultSet,
  type SourceQuery,
} from '../schema/query.js';
import type { DataSourceDescriptor } from '../schema/descriptor.js';

/**
 * The reusable Data Source Provider harness.
 *
 * Every data-source connector implements the same three endpoints, so this carries the
 * parts that must be identical everywhere — bearer auth, request validation, scope
 * intersection, error shaping — and leaves each connector with just a descriptor and a
 * query handler. Writing a new connector should be a day's work, not a week's.
 *
 * Framework-agnostic on purpose: it exposes plain handlers rather than Express middleware,
 * so a connector can host it on Express, Fastify or a serverless function.
 */

export class DspFailure extends Error {
  constructor(
    readonly code: DspErrorCode,
    message: string,
    readonly options: { retryable?: boolean; retryAfterSeconds?: number; status?: number } = {}
  ) {
    super(message);
    this.name = 'DspFailure';
  }

  get status(): number {
    if (this.options.status) return this.options.status;
    switch (this.code) {
      case 'QUOTA_EXCEEDED':
        return 429;
      case 'UPSTREAM_TIMEOUT':
        return 504;
      case 'UPSTREAM_UNAVAILABLE':
        return 503;
      case 'UPSTREAM_AUTH':
        return 502;
      case 'INTERNAL':
        return 500;
      // Capability problems are the caller's: it planned against a stale descriptor.
      default:
        return 400;
    }
  }
}

export const bearerMatches = (header: string | undefined, expected: string): boolean => {
  if (!header) return false;
  const provided = header.replace(/^Bearer\s+/i, '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch. The remaining
  // comparison is constant-time, which is what matters for a shared secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

/**
 * Validates a request against the descriptor BEFORE the handler runs.
 *
 * Catching these here rather than in the handler means every connector reports capability
 * problems identically, and the gateway can reliably treat them as "my descriptor is
 * stale, refetch and replan" instead of as an outage.
 */
export const validateAgainstDescriptor = (
  query: SourceQuery,
  descriptor: DataSourceDescriptor
): void => {
  if (query.protocolVersion !== descriptor.protocolVersion) {
    throw new DspFailure(
      'PROTOCOL_VERSION_UNSUPPORTED',
      `This source speaks protocol v${descriptor.protocolVersion}, not v${query.protocolVersion}`
    );
  }

  const served = new Set(descriptor.capabilities.metrics.map((m) => m.metricId));
  const unsupportedMetrics = query.metrics.filter((m) => !served.has(m));
  if (unsupportedMetrics.length > 0) {
    throw new DspFailure(
      'UNSUPPORTED_METRIC',
      `${descriptor.sourceId} does not serve ${unsupportedMetrics.join(', ')}`
    );
  }

  const dimensionIds = new Set(descriptor.capabilities.dimensions.map((d) => d.dimensionId));
  const unsupportedDimensions = query.dimensions.filter((d) => !dimensionIds.has(d));
  if (unsupportedDimensions.length > 0) {
    throw new DspFailure(
      'UNSUPPORTED_DIMENSION',
      `${descriptor.sourceId} cannot split by ${unsupportedDimensions.join(', ')}`
    );
  }

  // Per-metric dimension support is narrower than the source-level list.
  for (const metricId of query.metrics) {
    const capability = descriptor.capabilities.metrics.find((m) => m.metricId === metricId)!;
    const missing = query.dimensions.filter((d) => !capability.dimensions.includes(d));
    if (missing.length > 0) {
      throw new DspFailure(
        'UNSUPPORTED_DIMENSION',
        `${descriptor.sourceId} cannot split ${metricId} by ${missing.join(', ')}`
      );
    }
    if (query.grain && !capability.grains.includes(query.grain)) {
      // A metric with NO grains at all is a point-in-time snapshot (a live catalogue facet,
      // say). Reporting "serves  , not day" for that case is useless, so name the real
      // problem: the caller mixed a snapshot metric into a time series.
      throw new DspFailure(
        'UNSUPPORTED_GRAIN',
        capability.grains.length === 0
          ? `${metricId} is a point-in-time metric with no time grain, so it cannot be ` +
            `requested at ${query.grain} grain alongside time-bucketed metrics — a snapshot ` +
            `and a time series have no common answer`
          : `${descriptor.sourceId} serves ${metricId} at ${capability.grains.join('/')}, not ${query.grain}`
      );
    }
  }

  const filtered = new Set(query.filters.map((f) => f.dimension));
  const missingRequired = descriptor.capabilities.requiresFilters.filter((d) => !filtered.has(d));
  if (missingRequired.length > 0) {
    throw new DspFailure(
      'FILTER_REQUIRED',
      `${descriptor.sourceId} requires a filter on ${missingRequired.join(', ')}`
    );
  }

  // Fail closed on scope. If the gateway asks us to restrict rows on a dimension we cannot
  // even split by, we must refuse — silently returning unrestricted data would hand the
  // caller a figure that looks scoped and is not.
  const requested: Array<[string, string[] | undefined]> = [
    ['store', query.scope.stores],
    ['businessUnit', query.scope.businessUnits],
    ['distributionChannel', query.scope.channels],
    ['country', query.scope.countries],
  ];
  if (!query.scope.unrestricted) {
    for (const [dimension, values] of requested) {
      if (!values) continue;
      if (!descriptor.scoping.rowLevelDimensions.includes(dimension)) {
        throw new DspFailure(
          'SCOPE_UNSATISFIABLE',
          `${descriptor.sourceId} cannot restrict rows by ${dimension}`
        );
      }
      if (values.length === 0) {
        // An empty allow-list means "no data", which is a legitimate empty result, not an
        // error — but the handler must not treat it as "no restriction".
        continue;
      }
    }
  }
};

export interface DspHandlerContext {
  query: SourceQuery;
  descriptor: DataSourceDescriptor;
}

export type DspQueryHandler = (context: DspHandlerContext) => Promise<ResultSet>;

export interface DspServerOptions {
  sharedSecret: string;
  descriptor: () => DataSourceDescriptor;
  handler: DspQueryHandler;
  health?: () => Promise<Record<string, unknown>>;
}

export interface DspResponse {
  status: number;
  body: unknown;
}

/**
 * The three endpoints, as plain functions. A connector wires these to its HTTP framework.
 */
export const createDspHandlers = (options: DspServerOptions) => {
  const authorise = (authorization: string | undefined): void => {
    if (!bearerMatches(authorization, options.sharedSecret)) {
      throw new DspFailure('UPSTREAM_AUTH', 'Invalid or missing bearer token', { status: 401 });
    }
  };

  const toErrorResponse = (
    error: unknown,
    sourceId: string,
    requestId: string
  ): DspResponse => {
    if (error instanceof DspFailure) {
      return {
        status: error.status,
        body: {
          code: error.code,
          message: error.message,
          retryable: error.options.retryable ?? false,
          ...(error.options.retryAfterSeconds
            ? { retryAfterSeconds: error.options.retryAfterSeconds }
            : {}),
          sourceId,
          requestId,
        },
      };
    }
    // Never echo an upstream error body: it can carry hostnames, query shapes and
    // occasionally credentials.
    return {
      status: 500,
      body: {
        code: 'INTERNAL',
        message: 'The data source encountered an internal error.',
        retryable: false,
        sourceId,
        requestId,
      },
    };
  };

  return {
    /** Unauthenticated liveness. */
    async health(): Promise<DspResponse> {
      const descriptor = options.descriptor();
      const extra = options.health ? await options.health() : {};
      return {
        status: 200,
        body: {
          status: 'ok',
          sourceId: descriptor.sourceId,
          connectorVersion: descriptor.connector.version,
          demoMode: descriptor.demoMode,
          ...extra,
        },
      };
    },

    async describe(authorization: string | undefined): Promise<DspResponse> {
      try {
        authorise(authorization);
        return { status: 200, body: options.descriptor() };
      } catch (error) {
        return toErrorResponse(error, options.descriptor().sourceId, 'describe');
      }
    },

    async query(authorization: string | undefined, rawBody: unknown): Promise<DspResponse> {
      const descriptor = options.descriptor();
      let requestId = 'unknown';
      try {
        authorise(authorization);

        const parsed = sourceQuerySchema.safeParse(rawBody);
        if (!parsed.success) {
          throw new DspFailure(
            'INTERNAL',
            `Malformed query: ${parsed.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
            { status: 400 }
          );
        }
        requestId = parsed.data.requestId;

        validateAgainstDescriptor(parsed.data, descriptor);
        const resultSet = await options.handler({ query: parsed.data, descriptor });
        return { status: 200, body: resultSet };
      } catch (error) {
        return toErrorResponse(error, descriptor.sourceId, requestId);
      }
    },
  };
};

/** Helper for handlers: builds a well-formed, honest ResultSet. */
export const buildResultSet = (options: {
  descriptor: DataSourceDescriptor;
  columns: ResultSet['columns'];
  rows: ResultSet['rows'];
  execution: 'live' | 'materialized';
  dataAsOf: string;
  grainServed?: ResultSet['flags']['grainServed'];
  partial?: boolean;
  degradedReason?: ResultSet['flags']['degradedReason'];
  detail?: string;
  rowsTruncated?: number;
  cacheHit?: boolean;
  upstreamRequests?: number;
  ttlSeconds?: number;
}): ResultSet => {
  const {
    descriptor,
    columns,
    rows,
    execution,
    dataAsOf,
    grainServed = null,
    partial = false,
    degradedReason,
    detail,
    rowsTruncated,
    cacheHit = false,
    upstreamRequests = 0,
    ttlSeconds,
  } = options;

  const lagSeconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(dataAsOf)) / 1000) || descriptor.freshness.typicalLagSeconds
  );

  return {
    protocolVersion: 1,
    sourceId: descriptor.sourceId,
    columns,
    rows,
    rowCount: rows.length,
    status: rows.length === 0 ? 'empty' : degradedReason ? 'degraded' : partial ? 'partial' : 'ok',
    flags: {
      partial,
      ...(degradedReason ? { degradedReason } : {}),
      ...(detail ? { detail } : {}),
      ...(rowsTruncated ? { rowsTruncated } : {}),
      grainServed,
    },
    provenance: {
      sourceId: descriptor.sourceId,
      connectorVersion: descriptor.connector.version,
      execution,
      dataAsOf,
      freshnessLagSeconds: lagSeconds,
      cacheHit,
      upstreamRequests,
    },
    cacheHints: {
      ttlSeconds: ttlSeconds ?? descriptor.freshness.recommendedCacheTtlSeconds,
      staleWhileRevalidateSeconds: 60,
    },
  };
};
