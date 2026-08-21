import { describe, expect, it, vi } from 'vitest';
import { runReport } from '../src/run-report.js';
import { MemoryCache } from '../src/cache/memory.js';
import { SourceClient } from '../src/sources/source-client.js';
import { createLogger } from '../src/logger.js';
import { BUILTIN_REPORTS } from '../src/shared/catalogue/index.js';
import { DEFAULT_POLICIES, resolveAccess } from '../src/shared/framing/access.js';
import type { DataSourceDescriptor } from '../src/shared/schema/descriptor.js';
import type { SourceQuery } from '../src/shared/schema/query.js';
import type { TileResult } from '../src/run-report.js';

const silentLog = createLogger('error');

const metricCap = (metricId: string, dimensions: string[] = ['date', 'currency', 'distributionChannel', 'product']) => ({
  metricId,
  execution: 'materialized' as const,
  grains: ['day' as const, 'week' as const, 'month' as const],
  dimensions,
  costClass: 'cheap' as const,
  exactness: 'exact' as const,
});

const source = (
  sourceId: string,
  metrics: string[],
  over: Partial<DataSourceDescriptor> = {}
): DataSourceDescriptor => ({
  descriptorVersion: 1,
  protocolVersion: 1,
  sourceId,
  labelKey: `source.${sourceId}`,
  displayName: sourceId,
  kind: 'commerce',
  connector: { name: sourceId, version: '1.0.0' },
  endpointUrl: `https://${sourceId}.example.com`,
  authMode: 'shared-secret',
  demoMode: false,
  capabilities: {
    metrics: metrics.map((m) => metricCap(m)),
    dimensions: [
      { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
      { dimensionId: 'currency', canonicalKeyDefinition: 'iso-4217', filterable: true },
      { dimensionId: 'product', canonicalKeyDefinition: 'commercetools:variant.sku', filterable: true },
      { dimensionId: 'distributionChannel', filterable: true },
    ],
    grains: ['day', 'week', 'month'],
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
  ...over,
});

/** A fake connector that records what it was asked, and answers with plausible rows. */
const fakeConnector = (
  values: Record<string, number>,
  options: { fail?: boolean } = {}
) => {
  const seen: SourceQuery[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as SourceQuery;
    seen.push(request);

    if (options.fail) return new Response('down', { status: 503 });

    const metricColumns = request.metrics.map((id) => ({
      id,
      role: 'metric' as const,
      valueType: 'count' as const,
      exactness: 'exact' as const,
      nullMeaning: 'zero' as const,
    }));
    const dimensionColumns = (request.dimensions ?? []).map((id) => ({
      id,
      role: 'dimension' as const,
      valueType: 'string' as const,
      exactness: 'exact' as const,
      nullMeaning: 'unknown' as const,
    }));

    const body = {
      protocolVersion: 1,
      sourceId: 'fake',
      columns: [
        { id: 'date', role: 'time', valueType: 'time', exactness: 'exact', nullMeaning: 'unknown' },
        ...dimensionColumns,
        ...metricColumns,
      ],
      rows: [
        [
          '2026-08-19',
          ...(request.dimensions ?? []).map((d) => (d === 'currency' ? 'EUR' : `${d}-1`)),
          ...request.metrics.map((m) => values[m] ?? 0),
        ],
      ],
      rowCount: 1,
      status: 'ok',
      flags: { partial: false, grainServed: 'day' },
      provenance: {
        sourceId: 'fake',
        connectorVersion: '1.0.0',
        execution: 'materialized',
        dataAsOf: '2026-08-20T02:00:00Z',
        freshnessLagSeconds: 3600,
        cacheHit: false,
        upstreamRequests: 0,
      },
      cacheHints: { ttlSeconds: 300, staleWhileRevalidateSeconds: 0 },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, seen };
};

const deps = (fetchImpl: typeof fetch) => ({
  sourceClient: new SourceClient({
    sharedSecret: 'a-sufficiently-long-secret',
    timeoutMs: 5000,
    log: silentLog,
    fetchImpl,
  }),
  cache: new MemoryCache<TileResult>(50),
  log: silentLog,
  today: '2026-08-20',
  registryVersion: 'test',
  restatementEpoch: 1,
  ttlTodaySeconds: 300,
  ttlSealedSeconds: 604_800,
  maxConcurrency: 4,
  onStaleDescriptor: async () => [],
});

const unrestrictedAccess = () =>
  resolveAccess(
    { id: 'u1', permissions: ['canViewReporting'], projectKey: 'demo', locale: 'en' },
    DEFAULT_POLICIES,
    null
  );

const storeScopedAccess = () =>
  resolveAccess(
    { id: 'u2', permissions: ['canViewReporting'], projectKey: 'demo', locale: 'en' },
    [
      ...DEFAULT_POLICIES,
      {
        key: 'store-manager',
        priority: 300,
        match: { anyPermission: ['canViewReporting'] },
        grant: { capabilities: [] },
        rowScope: { dimension: 'stores', from: 'literal', values: ['de-berlin-01'] },
      },
    ],
    null
  );

describe('runReport', () => {
  const report = BUILTIN_REPORTS['trading-dashboard'];
  const commerce = () =>
    source('ct-native', [
      'orders.count@orderdate',
      'revenue.net@orderdate',
      'units.sold@orderdate',
      'returns.units@orderdate',
      'refunds.value@cashdate',
    ]);

  it('resolves the date range from the report default preset', async () => {
    const { fetchImpl, seen } = fakeConnector({ 'orders.count@orderdate': 100 });
    const result = await runReport(report, {}, unrestrictedAccess(), [commerce()], deps(fetchImpl));

    // last28d, exclusive of the partial current day.
    expect(result.range).toEqual({ from: '2026-07-23', to: '2026-08-20' });
    expect(result.compareRange).toEqual({ from: '2026-06-25', to: '2026-07-23' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].timeRange).toEqual({ from: '2026-07-23', to: '2026-08-20' });
  });

  it('injects the server-derived scope and IGNORES any client-supplied scope', async () => {
    const { fetchImpl, seen } = fakeConnector({ 'orders.count@orderdate': 100 });
    // A malicious client tries to widen its own scope through the request body.
    const malicious = {
      scope: { unrestricted: true, stores: ['uk-manchester'] },
    } as unknown as Parameters<typeof runReport>[1];

    await runReport(report, malicious, storeScopedAccess(), [commerce()], deps(fetchImpl));

    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request.scope.stores).toEqual(['de-berlin-01']);
      expect(request.scope.unrestricted).toBe(false);
    }
  });

  it('auto-injects currency into the group-by when a money metric is requested', async () => {
    const { fetchImpl, seen } = fakeConnector({ 'revenue.net@orderdate': 123456 });
    await runReport(report, {}, unrestrictedAccess(), [commerce()], deps(fetchImpl));

    const revenueRequest = seen.find((r) => r.metrics.includes('revenue.net@orderdate'));
    expect(revenueRequest?.dimensions).toContain('currency');
  });

  it('marks a tile unavailable — not wrong — when no source serves its metric', async () => {
    // The conversion-rate tile needs sessions, which a commerce-only install cannot serve.
    const { fetchImpl } = fakeConnector({ 'orders.count@orderdate': 100 });
    const result = await runReport(report, {}, unrestrictedAccess(), [commerce()], deps(fetchImpl));

    const conversionTile = result.tiles.find((t) => t.tileId === 'kpi-conversion')!;
    expect(conversionTile.status).toBe('unavailable');
    expect(conversionTile.unavailableMetrics.map((u) => u.metric)).toContain('sessions.count');
    // The rest of the report still renders.
    expect(result.tiles.find((t) => t.tileId === 'kpi-orders')?.status).toBe('ok');
    expect(result.status).toBe('partial');
  });

  it('records per-metric provenance so a user can see where a number came from', async () => {
    const { fetchImpl } = fakeConnector({ 'orders.count@orderdate': 100 });
    const result = await runReport(report, {}, unrestrictedAccess(), [commerce()], deps(fetchImpl));

    const ordersTile = result.tiles.find((t) => t.tileId === 'kpi-orders')!;
    expect(ordersTile.provenance).toContainEqual({
      metric: 'orders.count@orderdate',
      sourceId: 'ct-native',
      rule: expect.any(String),
    });
  });

  it('degrades to a partial report when a source is down, instead of failing', async () => {
    const { fetchImpl } = fakeConnector({}, { fail: true });
    const result = await runReport(report, {}, unrestrictedAccess(), [commerce()], deps(fetchImpl));

    expect(result.status).toBe('failed');
    // "failed" here means every tile was unavailable — but the call still returned a
    // structured result with reasons rather than throwing.
    expect(result.tiles.every((t) => t.status === 'unavailable')).toBe(true);
  });

  it('serves a second identical run from cache', async () => {
    const { fetchImpl } = fakeConnector({ 'orders.count@orderdate': 100 });
    const sharedDeps = deps(fetchImpl);

    await runReport(report, {}, unrestrictedAccess(), [commerce()], sharedDeps);
    const callsAfterFirst = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const second = await runReport(report, {}, unrestrictedAccess(), [commerce()], sharedDeps);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
    expect(second.tiles.some((t) => t.cacheHit)).toBe(true);
  });

  it('does NOT share cache between subjects with different scopes', async () => {
    // The leak this prevents: a store manager being served a tile populated for an
    // all-stores user.
    const { fetchImpl } = fakeConnector({ 'orders.count@orderdate': 100 });
    const sharedDeps = deps(fetchImpl);

    await runReport(report, {}, unrestrictedAccess(), [commerce()], sharedDeps);
    const callsAfterFirst = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const scoped = await runReport(report, {}, storeScopedAccess(), [commerce()], sharedDeps);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsAfterFirst
    );
    expect(scoped.tiles.every((t) => !t.cacheHit)).toBe(true);
  });

  it('reports dataAsOf as the oldest contributing watermark', async () => {
    const { fetchImpl } = fakeConnector({ 'orders.count@orderdate': 100 });
    const result = await runReport(report, {}, unrestrictedAccess(), [commerce()], deps(fetchImpl));
    expect(result.dataAsOf).toBe('2026-08-20T02:00:00Z');
  });
});
