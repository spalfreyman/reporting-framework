import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfiguration, resetConfiguration } from '../src/env.js';
import { MemoryCache } from '../src/cache/memory.js';
import { SourceClient, SourceCallError, constantTimeEquals, verifyScope } from '../src/sources/source-client.js';
import { createLogger } from '../src/logger.js';
import type { ResultSet, RowScope } from '../src/shared/schema/query.js';
import type { DataSourceDescriptor } from '../src/shared/schema/descriptor.js';

const BASE_ENV = {
  CTP_PROJECT_KEY: 'demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'view_orders manage_key_value_documents',
  CLOUD_IDENTIFIER: 'gcp-eu',
  CONNECT_SERVICE_URL: 'https://svc-abc123.europe-west1.gcp.commercetools.app/gateway',
  REPORTING_SHARED_SECRET: 'a-sufficiently-long-secret',
};

const silentLog = createLogger('error');

describe('configuration', () => {
  beforeEach(() => resetConfiguration());

  it('derives an ORIGIN-ONLY session audience from the injected service URL', () => {
    // The Merchant Center app sends audiencePolicy 'forward-url-origin'. A full-path
    // audience here would never match, and every request would 401 with no obvious cause.
    const config = readConfiguration(BASE_ENV as unknown as NodeJS.ProcessEnv);
    expect(config.sessionAudience).toBe('https://svc-abc123.europe-west1.gcp.commercetools.app');
    expect(config.sessionAudience).not.toContain('/gateway');
  });

  it('builds region-specific auth and API URLs', () => {
    const config = readConfiguration(BASE_ENV as unknown as NodeJS.ProcessEnv);
    expect(config.authUrl).toBe('https://auth.europe-west1.gcp.commercetools.com');
    expect(config.apiUrl).toBe('https://api.europe-west1.gcp.commercetools.com');
  });

  it('fails at boot on missing configuration rather than at first request', () => {
    const { CTP_CLIENT_SECRET, ...incomplete } = BASE_ENV;
    void CTP_CLIENT_SECRET;
    expect(() => readConfiguration(incomplete as unknown as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration.*CTP_CLIENT_SECRET/s
    );
  });

  it('rejects a shared secret short enough to brute-force', () => {
    expect(() =>
      readConfiguration({ ...BASE_ENV, REPORTING_SHARED_SECRET: 'short' } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/at least 16 characters/);
  });

  it('rejects an unknown cloud identifier instead of guessing an issuer', () => {
    expect(() =>
      readConfiguration({ ...BASE_ENV, CLOUD_IDENTIFIER: 'gcp-mars' } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/CLOUD_IDENTIFIER/);
  });
});

describe('shared-secret comparison', () => {
  it('matches an identical secret and rejects a different one', () => {
    expect(constantTimeEquals('abcdefghijklmnop', 'abcdefghijklmnop')).toBe(true);
    expect(constantTimeEquals('abcdefghijklmnop', 'abcdefghijklmnoq')).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths, so the guard has to come first.
    expect(constantTimeEquals('short', 'a-much-longer-secret')).toBe(false);
  });
});

// ── Scope enforcement ───────────────────────────────────────────────────────────

const resultSet = (
  columns: Array<{ id: string; role: 'dimension' | 'metric' | 'time' }>,
  rows: Array<Array<string | number | null>>
): ResultSet => ({
  protocolVersion: 1,
  sourceId: 'ct-native',
  columns: columns.map((c) => ({
    ...c,
    valueType: c.role === 'metric' ? 'count' : 'string',
    exactness: 'exact',
    nullMeaning: 'zero',
  })),
  rows,
  rowCount: rows.length,
  status: 'ok',
  flags: { partial: false, grainServed: 'day' },
  provenance: {
    sourceId: 'ct-native',
    connectorVersion: '1.0.0',
    execution: 'materialized',
    dataAsOf: '2026-08-20T02:00:00Z',
    freshnessLagSeconds: 3600,
    cacheHit: false,
    upstreamRequests: 0,
  },
  cacheHints: { ttlSeconds: 300, staleWhileRevalidateSeconds: 0 },
});

describe('response scope verification', () => {
  const scoped: RowScope = { stores: ['de-berlin-01'], unrestricted: false };

  it('accepts a response entirely inside scope', () => {
    const rs = resultSet(
      [
        { id: 'store', role: 'dimension' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [['de-berlin-01', 10]]
    );
    expect(verifyScope(rs, scoped)).toEqual({ ok: true });
  });

  it('rejects the WHOLE response when any row falls outside scope', () => {
    // A source that gets scope wrong cannot be trusted to have got the rest right, so we
    // discard rather than filter.
    const rs = resultSet(
      [
        { id: 'store', role: 'dimension' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [
        ['de-berlin-01', 10],
        ['uk-manchester', 99],
      ]
    );
    const outcome = verifyScope(rs, scoped);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.violation).toMatch(/uk-manchester/);
  });

  it('skips verification entirely for an unrestricted subject', () => {
    const rs = resultSet([{ id: 'store', role: 'dimension' }], [['anything']]);
    expect(verifyScope(rs, { unrestricted: true })).toEqual({ ok: true });
  });

  it('cannot verify a scope dimension the response does not carry', () => {
    // This is precisely why the planner fails closed and refuses to use a source that
    // cannot split by the scope dimension: there is nothing here to check.
    const rs = resultSet([{ id: 'date', role: 'time' }], [['2026-08-20']]);
    expect(verifyScope(rs, scoped)).toEqual({ ok: true });
  });
});

// ── Source client ───────────────────────────────────────────────────────────────

const descriptor: DataSourceDescriptor = {
  descriptorVersion: 1,
  protocolVersion: 1,
  sourceId: 'ct-native',
  labelKey: 'source.ctNative',
  displayName: 'commercetools',
  kind: 'commerce',
  connector: { name: 'ct-native', version: '1.0.0' },
  endpointUrl: 'https://ct-native.example.com',
  authMode: 'shared-secret',
  demoMode: false,
  capabilities: {
    metrics: [],
    dimensions: [],
    grains: ['day'],
    timezone: 'UTC',
    maxRowsPerResponse: 10000,
    supportsPagination: false,
    supportsCompare: false,
    supportsDimensionValues: false,
    requiresFilters: [],
  },
  freshness: {
    mode: 'materialized',
    updateFrequency: 'daily',
    typicalLagSeconds: 3600,
    maxLagSeconds: 86400,
    restatementWindowDays: 90,
    recommendedCacheTtlSeconds: 300,
  },
  scoping: { rowLevelDimensions: ['store'] },
  provenance: { systemOfRecord: true, authorityRank: 10 },
  registeredAt: '2026-08-01T00:00:00Z',
};

const query = {
  protocolVersion: 1 as const,
  requestId: 'req-1',
  projectKey: 'demo',
  metrics: ['orders.count@orderdate'],
  dimensions: [],
  grain: 'day' as const,
  timezone: 'UTC',
  filters: [],
  scope: { unrestricted: true },
  orderBy: [],
  limit: 1000,
  budgetMs: 5000,
};

describe('source client', () => {
  it('sends the shared secret as a bearer token', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-secret-value');
      return new Response(JSON.stringify(resultSet([{ id: 'date', role: 'time' }], [['2026-08-20']])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new SourceClient({
      sharedSecret: 'test-secret-value',
      timeoutMs: 5000,
      log: silentLog,
      fetchImpl,
    });
    await client.query(descriptor, query, silentLog);
  });

  it('rejects a response that does not match the query protocol', async () => {
    // A malformed connector response must not flow into the merge as garbage.
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ nonsense: true }), { status: 200 })
    ) as unknown as typeof fetch;

    const client = new SourceClient({
      sharedSecret: 'secret',
      timeoutMs: 5000,
      log: silentLog,
      fetchImpl,
    });
    await expect(client.query(descriptor, query, silentLog)).rejects.toThrow(SourceCallError);
  });

  it('maps HTTP 429 to QUOTA_EXCEEDED', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'slow down', retryAfterSeconds: 30 }), { status: 429 })
    ) as unknown as typeof fetch;

    const client = new SourceClient({
      sharedSecret: 'secret',
      timeoutMs: 5000,
      log: silentLog,
      fetchImpl,
    });
    await expect(client.query(descriptor, query, silentLog)).rejects.toMatchObject({
      detail: { code: 'QUOTA_EXCEEDED', retryAfterSeconds: 30 },
    });
  });

  it('opens the circuit breaker after repeated failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const client = new SourceClient({
      sharedSecret: 'secret',
      timeoutMs: 5000,
      log: silentLog,
      fetchImpl,
    });

    for (let i = 0; i < 5; i += 1) {
      await client.query(descriptor, query, silentLog).catch(() => undefined);
    }
    expect(client.isOpen('ct-native')).toBe(true);

    // Once open, we stop calling the source at all rather than piling on.
    const callsBefore = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await expect(client.query(descriptor, query, silentLog)).rejects.toMatchObject({
      detail: { code: 'UPSTREAM_UNAVAILABLE' },
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it('does NOT count a capability error against the breaker', async () => {
    // A capability error means the cached descriptor was stale — a planning problem, not an
    // outage. Counting it would make a planning bug look like a broken source.
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'UNSUPPORTED_METRIC', message: 'nope', retryable: false }), {
          status: 400,
        })
    ) as unknown as typeof fetch;

    const client = new SourceClient({
      sharedSecret: 'secret',
      timeoutMs: 5000,
      log: silentLog,
      fetchImpl,
    });
    for (let i = 0; i < 6; i += 1) {
      await client.query(descriptor, query, silentLog).catch(() => undefined);
    }
    expect(client.isOpen('ct-native')).toBe(false);
  });

  it('times out on its own terms rather than hanging the report', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    ) as unknown as typeof fetch;

    const client = new SourceClient({
      sharedSecret: 'secret',
      timeoutMs: 20,
      log: silentLog,
      fetchImpl,
    });
    await expect(client.query(descriptor, query, silentLog)).rejects.toMatchObject({
      detail: { code: 'UPSTREAM_TIMEOUT' },
    });
  });

  it('trips immediately when asked, for a scope violation', () => {
    const client = new SourceClient({ sharedSecret: 'secret', timeoutMs: 5000, log: silentLog });
    expect(client.isOpen('ct-native')).toBe(false);
    client.trip('ct-native');
    expect(client.isOpen('ct-native')).toBe(true);
  });
});

// ── Cache ───────────────────────────────────────────────────────────────────────

describe('memory cache', () => {
  it('serves a fresh entry and reports it as not stale', () => {
    let clock = 1_000_000;
    const cache = new MemoryCache<string>(10, () => clock);
    cache.set('k', 'v', 60);
    expect(cache.get('k')).toEqual({ value: 'v', stale: false });
    clock += 30_000;
    expect(cache.get('k')).toEqual({ value: 'v', stale: false });
  });

  it('marks an entry stale after its TTL but still serves it within the SWR window', () => {
    let clock = 1_000_000;
    const cache = new MemoryCache<string>(10, () => clock);
    cache.set('k', 'v', 60, 60);
    clock += 61_000;
    expect(cache.get('k')).toEqual({ value: 'v', stale: true });
  });

  it('drops an entry once the stale window closes', () => {
    let clock = 1_000_000;
    const cache = new MemoryCache<string>(10, () => clock);
    cache.set('k', 'v', 60, 60);
    clock += 121_000;
    expect(cache.get('k')).toBeNull();
  });

  it('evicts the least recently used entry at capacity', () => {
    const cache = new MemoryCache<string>(2);
    cache.set('a', '1', 60);
    cache.set('b', '2', 60);
    cache.get('a'); // 'a' is now the most recently used
    cache.set('c', '3', 60);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')?.value).toBe('1');
    expect(cache.get('c')?.value).toBe('3');
  });
});
