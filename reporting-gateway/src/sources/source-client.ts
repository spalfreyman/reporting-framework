import { timingSafeEqual } from 'node:crypto';
import {
  isCapabilityError,
  resultSetSchema,
  type DspError,
  type DspErrorCode,
  type ResultSet,
  type RowScope,
  type SourceQuery,
} from '../shared/schema/query.js';
import type { DataSourceDescriptor } from '../shared/schema/descriptor.js';
import type { Logger } from '../logger.js';

/**
 * The HTTP client the gateway uses to talk to data-source connectors.
 *
 * Everything here exists because a connector is a separate process that can be slow, down,
 * rate-limited, or — since a third party may have written it — wrong.
 */

export class SourceCallError extends Error {
  constructor(readonly detail: DspError) {
    super(detail.message);
    this.name = 'SourceCallError';
  }
}

export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Compare lengths first, but still run a fixed comparison so the check itself does not
  // leak length through timing on the equal-length path.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
}

const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

export interface SourceClientOptions {
  sharedSecret: string;
  timeoutMs: number;
  log: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class SourceClient {
  private readonly breakers = new Map<string, BreakerState>();

  constructor(private readonly options: SourceClientOptions) {}

  private breaker(sourceId: string): BreakerState {
    const existing = this.breakers.get(sourceId);
    if (existing) return existing;
    const fresh: BreakerState = { consecutiveFailures: 0, openedAt: null };
    this.breakers.set(sourceId, fresh);
    return fresh;
  }

  isOpen(sourceId: string, now = this.options.now?.() ?? Date.now()): boolean {
    const state = this.breaker(sourceId);
    if (state.openedAt === null) return false;
    if (now - state.openedAt >= BREAKER_COOLDOWN_MS) {
      // Half-open: let one request through to probe.
      state.openedAt = null;
      state.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private recordFailure(sourceId: string, now: number): void {
    const state = this.breaker(sourceId);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= BREAKER_THRESHOLD && state.openedAt === null) {
      state.openedAt = now;
      this.options.log.warn('circuit breaker opened', {
        sourceId,
        consecutiveFailures: state.consecutiveFailures,
      });
    }
  }

  private recordSuccess(sourceId: string): void {
    const state = this.breaker(sourceId);
    state.consecutiveFailures = 0;
    state.openedAt = null;
  }

  /** Trips the breaker immediately — used when a source violates the scope contract. */
  trip(sourceId: string, now = this.options.now?.() ?? Date.now()): void {
    const state = this.breaker(sourceId);
    state.consecutiveFailures = BREAKER_THRESHOLD;
    state.openedAt = now;
  }

  async query(
    source: DataSourceDescriptor,
    request: SourceQuery,
    log: Logger
  ): Promise<ResultSet> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const now = () => this.options.now?.() ?? Date.now();

    if (this.isOpen(source.sourceId, now())) {
      throw new SourceCallError({
        code: 'UPSTREAM_UNAVAILABLE',
        message: `${source.sourceId} is circuit-broken after repeated failures`,
        retryable: false,
        sourceId: source.sourceId,
        requestId: request.requestId,
      });
    }

    // Budget the outbound call below our own timeout so we fail on our terms.
    const budgetMs = Math.min(this.options.timeoutMs, request.budgetMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    const startedAt = now();

    try {
      const response = await doFetch(`${source.endpointUrl.replace(/\/$/, '')}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.sharedSecret}`,
          'x-correlation-id': request.requestId,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Partial<DspError>;
        const code: DspErrorCode = body.code ?? (response.status === 429 ? 'QUOTA_EXCEEDED' : 'INTERNAL');
        const detail: DspError = {
          code,
          message: body.message ?? `${source.sourceId} returned HTTP ${response.status}`,
          retryable: body.retryable ?? response.status >= 500,
          retryAfterSeconds: body.retryAfterSeconds,
          sourceId: source.sourceId,
          requestId: request.requestId,
        };
        // A capability error is not a transport failure — the descriptor was stale. Do not
        // count it against the breaker, or a planning bug looks like an outage.
        if (!isCapabilityError(code)) this.recordFailure(source.sourceId, now());
        throw new SourceCallError(detail);
      }

      const parsed = resultSetSchema.safeParse(await response.json());
      if (!parsed.success) {
        this.recordFailure(source.sourceId, now());
        throw new SourceCallError({
          code: 'INTERNAL',
          message: `${source.sourceId} returned a response that does not match the query protocol`,
          retryable: false,
          sourceId: source.sourceId,
          requestId: request.requestId,
        });
      }

      this.recordSuccess(source.sourceId);
      log.debug('source query completed', {
        sourceId: source.sourceId,
        durationMs: now() - startedAt,
        rows: parsed.data.rowCount,
        status: parsed.data.status,
        cacheHit: parsed.data.provenance.cacheHit,
      });
      return parsed.data;
    } catch (error) {
      if (error instanceof SourceCallError) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      this.recordFailure(source.sourceId, now());
      throw new SourceCallError({
        code: aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        message: aborted
          ? `${source.sourceId} did not respond within ${budgetMs}ms`
          : `${source.sourceId} could not be reached`,
        retryable: true,
        sourceId: source.sourceId,
        requestId: request.requestId,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Verifies that returned rows actually fall inside the scope we asked for.
 *
 * Belt and braces: a data-source connector may be third-party code, and it is inside the
 * trust boundary once installed. If it returns a row outside scope we discard the WHOLE
 * response rather than filtering — a source that gets scope wrong cannot be trusted to have
 * got the rest right.
 */
export const verifyScope = (
  resultSet: ResultSet,
  scope: RowScope
): { ok: true } | { ok: false; violation: string } => {
  if (scope.unrestricted) return { ok: true };

  const checks: Array<{ column: string; allowed: string[] }> = [];
  if (scope.stores) checks.push({ column: 'store', allowed: scope.stores });
  if (scope.businessUnits) checks.push({ column: 'businessUnit', allowed: scope.businessUnits });
  if (scope.channels) checks.push({ column: 'distributionChannel', allowed: scope.channels });
  if (scope.countries) checks.push({ column: 'country', allowed: scope.countries });
  if (checks.length === 0) return { ok: true };

  for (const { column, allowed } of checks) {
    const index = resultSet.columns.findIndex((c) => c.id === column);
    if (index === -1) continue;
    for (const row of resultSet.rows) {
      const value = row[index];
      if (value === null || value === undefined) continue;
      if (!allowed.includes(String(value))) {
        return {
          ok: false,
          violation: `${resultSet.sourceId} returned ${column}="${String(value)}", which is outside the requested scope`,
        };
      }
    }
  }
  return { ok: true };
};
