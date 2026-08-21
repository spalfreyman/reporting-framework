import { describe, expect, it } from 'vitest';
import type { DataSourceDescriptor } from '../src/schema/descriptor.js';
import type { ResultSet } from '../src/schema/query.js';
import { planJoin } from '../src/planner/conformance.js';
import { mergeResults } from '../src/planner/merge.js';
import { selectSources } from '../src/planner/select-source.js';
import { cacheKey, decideTtl } from '../src/planner/cache-key.js';
import { resolveMetrics } from '../src/semantic/resolve.js';
import type { DerivedMetric } from '../src/semantic/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const descriptor = (over: Partial<DataSourceDescriptor> & { sourceId: string }): DataSourceDescriptor => ({
  descriptorVersion: 1,
  protocolVersion: 1,
  labelKey: `source.${over.sourceId}`,
  displayName: over.sourceId,
  kind: 'commerce',
  connector: { name: over.sourceId, version: '1.0.0' },
  endpointUrl: `https://${over.sourceId}.example.com`,
  authMode: 'shared-secret',
  demoMode: false,
  capabilities: {
    metrics: [],
    dimensions: [],
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
  scoping: { rowLevelDimensions: [] },
  provenance: { systemOfRecord: false, authorityRank: 0 },
  registeredAt: '2026-08-01T00:00:00Z',
  ...over,
});

const metricCap = (metricId: string, over: Record<string, unknown> = {}) => ({
  metricId,
  execution: 'materialized' as const,
  grains: ['day', 'week', 'month'] as Array<'day' | 'week' | 'month'>,
  dimensions: ['date', 'currency', 'store', 'country'],
  costClass: 'cheap' as const,
  exactness: 'exact' as const,
  ...over,
});

const resultSet = (
  sourceId: string,
  columns: Array<{ id: string; role: 'dimension' | 'metric' | 'time' }>,
  rows: Array<Array<string | number | null>>,
  over: Partial<ResultSet> = {}
): ResultSet => ({
  protocolVersion: 1,
  sourceId,
  columns: columns.map((c) => ({
    ...c,
    valueType: c.role === 'metric' ? ('count' as const) : ('string' as const),
    exactness: 'exact' as const,
    nullMeaning: 'zero' as const,
  })),
  rows,
  rowCount: rows.length,
  status: 'ok',
  flags: { partial: false, grainServed: 'day' },
  provenance: {
    sourceId,
    connectorVersion: '1.0.0',
    execution: 'materialized',
    dataAsOf: '2026-08-20T02:00:00Z',
    freshnessLagSeconds: 3600,
    cacheHit: false,
    upstreamRequests: 0,
  },
  cacheHints: { ttlSeconds: 300, staleWhileRevalidateSeconds: 0 },
  ...over,
});

// ── Join conformance ────────────────────────────────────────────────────────────

describe('join conformance', () => {
  const ct = descriptor({
    sourceId: 'ct-native',
    capabilities: {
      ...descriptor({ sourceId: 'x' }).capabilities,
      dimensions: [
        { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
        { dimensionId: 'country', canonicalKeyDefinition: 'iso-3166-1-alpha2', filterable: true },
        { dimensionId: 'distributionChannel', filterable: true },
      ],
      grains: ['day', 'week', 'month'],
      timezone: 'UTC',
      maxRowsPerResponse: 10000,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: false,
      requiresFilters: [],
      metrics: [],
    },
  });

  const ga4 = descriptor({
    sourceId: 'ga4',
    kind: 'web-analytics',
    capabilities: {
      ...descriptor({ sourceId: 'y' }).capabilities,
      dimensions: [
        { dimensionId: 'date', canonicalKeyDefinition: 'iso-8601-date', filterable: true },
        { dimensionId: 'country', canonicalKeyDefinition: 'iso-3166-1-alpha2', filterable: true },
        { dimensionId: 'trafficChannel', filterable: true },
      ],
      grains: ['day', 'week', 'month'],
      timezone: 'UTC',
      maxRowsPerResponse: 10000,
      supportsPagination: false,
      supportsCompare: false,
      supportsDimensionValues: false,
      requiresFilters: [],
      metrics: [],
    },
  });

  it('joins on conformed dimensions with matching canonical keys', () => {
    const plan = planJoin(['country'], 'day', [ct, ga4]);
    expect(plan.joinKey).toEqual(['date', 'country']);
    expect(plan.unjoinable).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it('refuses to join on a non-conformed dimension', () => {
    // distributionChannel (a sales channel) is NOT the same concept as GA4's
    // trafficChannel (a marketing acquisition channel). Joining them is the classic
    // silent-wrongness bug, so it must be refused rather than guessed.
    const plan = planJoin(['distributionChannel'], 'day', [ct, ga4]);
    expect(plan.joinKey).toEqual(['date']);
    expect(plan.unjoinable[0].dimension).toBe('distributionChannel');
    expect(plan.unjoinable[0].reason).toMatch(/not a conformed dimension/);
  });

  it('allows any dimension for a single-source query', () => {
    const plan = planJoin(['distributionChannel'], 'day', [ct]);
    expect(plan.joinKey).toEqual(['date', 'distributionChannel']);
    expect(plan.unjoinable).toEqual([]);
  });

  it('blocks a day-grain cross-source join when timezones disagree and neither offers hourly', () => {
    // commercetools is UTC; a GA4 property cuts days in its own timezone. Unhandled this
    // produces figures that are quietly wrong at day boundaries, which is worse than an error.
    const ga4Tokyo = descriptor({
      ...ga4,
      sourceId: 'ga4-tokyo',
      capabilities: { ...ga4.capabilities, timezone: 'Asia/Tokyo' },
    });
    const plan = planJoin(['country'], 'day', [ct, ga4Tokyo]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toMatch(/timezone/i);
  });

  it('permits a timezone-mismatched join when both sources can serve hourly', () => {
    const withHour = (s: DataSourceDescriptor, tz: string) =>
      descriptor({
        ...s,
        sourceId: `${s.sourceId}-h`,
        capabilities: { ...s.capabilities, grains: ['hour', 'day', 'month'], timezone: tz },
      });
    const plan = planJoin(['country'], 'day', [withHour(ct, 'UTC'), withHour(ga4, 'Asia/Tokyo')]);
    expect(plan.blockers).toEqual([]);
  });

  it('coarsens to the grain every source can serve, never rolling down', () => {
    const monthlyOnly = descriptor({
      ...ga4,
      sourceId: 'warehouse',
      capabilities: { ...ga4.capabilities, grains: ['month'] },
    });
    const plan = planJoin([], 'day', [ct, monthlyOnly]);
    expect(plan.effectiveGrain).toBe('month');
  });
});

// ── Source selection ────────────────────────────────────────────────────────────

describe('source selection', () => {
  const baseCaps = descriptor({ sourceId: 'x' }).capabilities;

  it('prefers one source that covers every metric over a multi-source plan', () => {
    // Cross-source joins are lossy; avoiding one is worth more than any per-metric optimum.
    const both = descriptor({
      sourceId: 'both',
      capabilities: {
        ...baseCaps,
        metrics: [metricCap('orders.count@orderdate'), metricCap('revenue.net@orderdate')],
      },
    });
    const ordersOnlyButFresher = descriptor({
      sourceId: 'fresh',
      capabilities: { ...baseCaps, metrics: [metricCap('orders.count@orderdate')] },
      freshness: { ...both.freshness, typicalLagSeconds: 1 },
    });

    const { assignments, singleSource } = selectSources([both, ordersOnlyButFresher], {
      metrics: ['orders.count@orderdate', 'revenue.net@orderdate'],
      dimensions: [],
      grain: 'day',
      range: { from: '2026-08-01', to: '2026-08-20' },
      today: '2026-08-20',
    });

    expect(singleSource).toBe('both');
    expect(assignments.every((a) => a.sourceId === 'both')).toBe(true);
    expect(assignments[0].rule).toBe('set-cover');
  });

  it('falls back to per-metric assignment when no single source covers everything', () => {
    const ct = descriptor({
      sourceId: 'ct-native',
      capabilities: { ...baseCaps, metrics: [metricCap('orders.count@orderdate')] },
    });
    const ga4 = descriptor({
      sourceId: 'ga4',
      kind: 'web-analytics',
      capabilities: { ...baseCaps, metrics: [metricCap('sessions.count')] },
    });

    const { assignments, singleSource } = selectSources([ct, ga4], {
      metrics: ['orders.count@orderdate', 'sessions.count'],
      dimensions: [],
      grain: 'day',
      range: { from: '2026-08-01', to: '2026-08-20' },
      today: '2026-08-20',
    });

    expect(singleSource).toBeNull();
    expect(assignments.find((a) => a.metric === 'orders.count@orderdate')?.sourceId).toBe('ct-native');
    expect(assignments.find((a) => a.metric === 'sessions.count')?.sourceId).toBe('ga4');
  });

  it('fails closed when a source cannot enforce the required row scope', () => {
    // You cannot post-filter GA4 aggregates down to one store if GA4 cannot split by store.
    // Pretending otherwise yields a number that looks store-specific and is not.
    const cannotScope = descriptor({
      sourceId: 'ga4',
      capabilities: { ...baseCaps, metrics: [metricCap('sessions.count')] },
      scoping: { rowLevelDimensions: [] },
    });

    const { assignments } = selectSources([cannotScope], {
      metrics: ['sessions.count'],
      dimensions: [],
      grain: 'day',
      range: { from: '2026-08-01', to: '2026-08-20' },
      today: '2026-08-20',
      requiredScopeDimensions: ['store'],
    });

    expect(assignments[0].sourceId).toBeNull();
    expect(assignments[0].rejected[0].reason).toMatch(/cannot enforce row-level scope on store/);
  });

  it('rejects a source that would have to roll down to a finer grain', () => {
    const monthly = descriptor({
      sourceId: 'warehouse',
      capabilities: {
        ...baseCaps,
        grains: ['month'],
        metrics: [metricCap('revenue.net@orderdate', { grains: ['month'] })],
      },
    });
    const { assignments } = selectSources([monthly], {
      metrics: ['revenue.net@orderdate'],
      dimensions: [],
      grain: 'day',
      range: { from: '2026-08-01', to: '2026-08-20' },
      today: '2026-08-20',
    });
    expect(assignments[0].sourceId).toBeNull();
    expect(assignments[0].rejected[0].reason).toMatch(/cannot roll down/);
  });

  it('is deterministic: identical requests produce identical plans', () => {
    // Otherwise caching and support both break.
    const a = descriptor({
      sourceId: 'aaa',
      capabilities: { ...baseCaps, metrics: [metricCap('orders.count@orderdate')] },
    });
    const b = descriptor({
      sourceId: 'bbb',
      capabilities: { ...baseCaps, metrics: [metricCap('orders.count@orderdate')] },
    });
    const ctx = {
      metrics: ['orders.count@orderdate'],
      dimensions: [],
      grain: 'day' as const,
      range: { from: '2026-08-01', to: '2026-08-20' },
      today: '2026-08-20',
    };
    const first = selectSources([a, b], ctx);
    const second = selectSources([b, a], ctx);
    expect(first.assignments[0].sourceId).toBe(second.assignments[0].sourceId);
    expect(first.assignments[0].sourceId).toBe('aaa');
  });

  it('honours a customer source-priority override', () => {
    const ct = descriptor({
      sourceId: 'ct-native',
      capabilities: { ...baseCaps, metrics: [metricCap('revenue.net@orderdate')] },
    });
    const warehouse = descriptor({
      sourceId: 'warehouse',
      capabilities: { ...baseCaps, metrics: [metricCap('revenue.net@orderdate')] },
    });
    const { assignments } = selectSources([ct, warehouse], {
      metrics: ['revenue.net@orderdate'],
      dimensions: [],
      grain: 'day',
      range: { from: '2026-08-01', to: '2026-08-20' },
      today: '2026-08-20',
      sourcePriority: { 'revenue.net@orderdate': ['warehouse', 'ct-native'] },
    });
    expect(assignments[0].sourceId).toBe('warehouse');
  });
});

// ── Merge ───────────────────────────────────────────────────────────────────────

describe('merge', () => {
  const derivedConversion = (): Array<{ id: string; def: DerivedMetric }> => {
    const { derived } = resolveMetrics(['conversion.rate']);
    return derived;
  };

  it('FULL OUTER joins: keeps days only one source has', () => {
    // An inner join silently drops days GA4 has and commercetools does not, and vice
    // versa, which surfaces as a mysteriously short chart.
    const ct = resultSet(
      'ct-native',
      [
        { id: 'date', role: 'time' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [
        ['2026-08-18', 100],
        ['2026-08-19', 120],
      ]
    );
    const ga4 = resultSet(
      'ga4',
      [
        { id: 'date', role: 'time' },
        { id: 'sessions.count', role: 'metric' },
      ],
      [
        ['2026-08-19', 5000],
        ['2026-08-20', 5200],
      ]
    );

    const merged = mergeResults(
      [
        { sourceId: 'ct-native', resultSet: ct },
        { sourceId: 'ga4', resultSet: ga4 },
      ],
      {
        joinKey: ['date'],
        baseMetrics: ['orders.count@orderdate', 'sessions.count'],
        derived: derivedConversion(),
        effectiveGrain: 'day',
      }
    );

    const dates = merged.rows.map((r) => r.date).sort();
    expect(dates).toEqual(['2026-08-18', '2026-08-19', '2026-08-20']);

    const only18 = merged.rows.find((r) => r.date === '2026-08-18')!;
    expect(only18['orders.count@orderdate']).toBe(100);
    expect(only18['sessions.count']).toBeUndefined();
    // A day with orders but no sessions has no conversion rate — null, not a wrong number.
    expect(only18['conversion.rate']).toBeNull();

    const both19 = merged.rows.find((r) => r.date === '2026-08-19')!;
    expect(both19['conversion.rate']).toBeCloseTo(120 / 5000);
  });

  it('refuses to aggregate a non-additive metric on fan-out rather than inflating it', () => {
    // Unguarded fan-out is the classic 3x-inflated-revenue bug.
    const rs = resultSet(
      'ct-native',
      [
        { id: 'date', role: 'time' },
        { id: 'store', role: 'dimension' },
        { id: 'customers.active@orderdate', role: 'metric' },
      ],
      [
        ['2026-08-19', 'a', 10],
        ['2026-08-19', 'b', 12],
      ]
    );

    // Join key omits `store`, so the two rows collapse onto one key.
    const merged = mergeResults([{ sourceId: 'ct-native', resultSet: rs }], {
      joinKey: ['date'],
      baseMetrics: ['customers.active@orderdate'],
      derived: [],
      effectiveGrain: 'day',
    });

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]['customers.active@orderdate']).toBeNull();
    expect(merged.notices.map((n) => n.code)).toContain('FAN_OUT_REFUSED');
  });

  it('sums additive metrics on fan-out', () => {
    const rs = resultSet(
      'ct-native',
      [
        { id: 'date', role: 'time' },
        { id: 'store', role: 'dimension' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [
        ['2026-08-19', 'a', 10],
        ['2026-08-19', 'b', 12],
      ]
    );
    const merged = mergeResults([{ sourceId: 'ct-native', resultSet: rs }], {
      joinKey: ['date'],
      baseMetrics: ['orders.count@orderdate'],
      derived: [],
      effectiveGrain: 'day',
    });
    expect(merged.rows[0]['orders.count@orderdate']).toBe(22);
  });

  it('recomputes ratio totals from summed components instead of averaging them', () => {
    // Averaging a column of ratios is simply the wrong number.
    const rs = resultSet(
      'ct-native',
      [
        { id: 'date', role: 'time' },
        { id: 'revenue.net@orderdate', role: 'metric' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [
        ['2026-08-18', 1000, 10], // AOV 100
        ['2026-08-19', 9000, 30], // AOV 300
      ]
    );
    const { derived } = resolveMetrics(['aov@orderdate']);
    const merged = mergeResults([{ sourceId: 'ct-native', resultSet: rs }], {
      joinKey: ['date'],
      baseMetrics: ['revenue.net@orderdate', 'orders.count@orderdate'],
      derived,
      effectiveGrain: 'day',
    });

    // Mean of the per-day AOVs would be 200. The correct total AOV is 10000/40 = 250.
    expect(merged.totals['aov@orderdate']).toBe(250);
  });

  it('omits non-additive metrics when rolling up over time, with a notice', () => {
    const rs = resultSet(
      'ct-native',
      [
        { id: 'date', role: 'time' },
        { id: 'orders.count@orderdate', role: 'metric' },
        { id: 'customers.active@orderdate', role: 'metric' },
      ],
      [
        ['2026-08-03', 10, 8],
        ['2026-08-04', 12, 9],
      ]
    );
    const merged = mergeResults([{ sourceId: 'ct-native', resultSet: rs }], {
      joinKey: ['date'],
      baseMetrics: ['orders.count@orderdate', 'customers.active@orderdate'],
      derived: [],
      effectiveGrain: 'month',
    });

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0].date).toBe('2026-08-01');
    expect(merged.rows[0]['orders.count@orderdate']).toBe(22);
    expect(merged.rows[0]['customers.active@orderdate']).toBeNull();
    expect(merged.notices.map((n) => n.code)).toContain('NON_ADDITIVE_ROLLUP');
  });

  it('reports dataAsOf as the MIN across contributors', () => {
    // Showing "updated 2 minutes ago" when the GA4 leg is 26 hours stale destroys trust.
    const fresh = resultSet('ct-native', [{ id: 'date', role: 'time' }], [['2026-08-20']], {
      provenance: {
        sourceId: 'ct-native',
        connectorVersion: '1.0.0',
        execution: 'materialized',
        dataAsOf: '2026-08-20T09:00:00Z',
        freshnessLagSeconds: 60,
        cacheHit: false,
        upstreamRequests: 0,
      },
    });
    const stale = resultSet('ga4', [{ id: 'date', role: 'time' }], [['2026-08-20']], {
      provenance: {
        sourceId: 'ga4',
        connectorVersion: '1.0.0',
        execution: 'materialized',
        dataAsOf: '2026-08-19T04:00:00Z',
        freshnessLagSeconds: 100000,
        cacheHit: true,
        upstreamRequests: 0,
      },
    });

    const merged = mergeResults(
      [
        { sourceId: 'ct-native', resultSet: fresh },
        { sourceId: 'ga4', resultSet: stale },
      ],
      { joinKey: ['date'], baseMetrics: [], derived: [], effectiveGrain: 'day' }
    );
    expect(merged.dataAsOf).toBe('2026-08-19T04:00:00Z');
  });

  it('marks a derived metric as estimated when any input is sampled', () => {
    const sampled = resultSet(
      'ga4',
      [
        { id: 'date', role: 'time' },
        { id: 'sessions.count', role: 'metric' },
      ],
      [['2026-08-19', 5000]]
    );
    sampled.columns[1].exactness = 'sampled';

    const exact = resultSet(
      'ct-native',
      [
        { id: 'date', role: 'time' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [['2026-08-19', 120]]
    );

    const merged = mergeResults(
      [
        { sourceId: 'ct-native', resultSet: exact },
        { sourceId: 'ga4', resultSet: sampled },
      ],
      {
        joinKey: ['date'],
        baseMetrics: ['orders.count@orderdate', 'sessions.count'],
        derived: derivedConversion(),
        effectiveGrain: 'day',
      }
    );

    const conversionColumn = merged.columns.find((c) => c.id === 'conversion.rate');
    expect(conversionColumn?.exactness).toBe('estimated');
  });

  it('builds an Other bucket for additive topN and skips it otherwise', () => {
    const rs = resultSet(
      'ct-native',
      [
        { id: 'country', role: 'dimension' },
        { id: 'orders.count@orderdate', role: 'metric' },
      ],
      [
        ['DE', 100],
        ['GB', 80],
        ['FR', 20],
        ['NL', 10],
      ]
    );
    const merged = mergeResults([{ sourceId: 'ct-native', resultSet: rs }], {
      joinKey: ['country'],
      baseMetrics: ['orders.count@orderdate'],
      derived: [],
      effectiveGrain: null,
      topN: { by: 'orders.count@orderdate', n: 2, otherBucket: true },
    });

    expect(merged.rows).toHaveLength(3);
    const other = merged.rows.find((r) => r.country === '__other__')!;
    expect(other['orders.count@orderdate']).toBe(30);
  });
});

// ── Cache keys ──────────────────────────────────────────────────────────────────

describe('cache keys', () => {
  const key = (over: Record<string, unknown> = {}) =>
    cacheKey({
      protocolVersion: 1,
      projectKey: 'demo',
      reportId: 'trading-dashboard',
      reportVersion: 1,
      tileId: 'kpi-revenue',
      metrics: ['revenue.net@orderdate'],
      dimensions: [],
      grain: 'day',
      timezone: 'UTC',
      range: { from: '2026-07-24', to: '2026-08-20' },
      filters: [],
      scopeHash: 'unrestricted',
      sourceSelectionHash: 'sel1',
      fxPolicyHash: 'fx1',
      registryVersion: '2026.08.1',
      restatementEpoch: 11,
      locale: 'en',
      ...over,
    } as Parameters<typeof cacheKey>[0]);

  it('is stable for identical input', () => {
    expect(key()).toBe(key());
  });

  it('changes when the scope changes', () => {
    // Omit scope from the key and a store manager's cached tile leaks to another store.
    expect(key()).not.toBe(key({ scopeHash: 'store:de-berlin-01' }));
  });

  it('changes when the restatement epoch is bumped', () => {
    // This is what makes post-backfill invalidation a single Custom Object write.
    expect(key()).not.toBe(key({ restatementEpoch: 12 }));
  });

  it('is insensitive to key order in the input object', () => {
    const a = key({ metrics: ['revenue.net@orderdate'], dimensions: [] });
    const b = key({ dimensions: [], metrics: ['revenue.net@orderdate'] });
    expect(a).toBe(b);
  });
});

describe('sealed/hot TTL', () => {
  it('gives a long TTL to a fully sealed historical range', () => {
    const decision = decideTtl(
      { from: '2025-01-01', to: '2025-02-01' },
      '2026-08-20',
      90,
      300,
      604800
    );
    expect(decision.fullySealed).toBe(true);
    expect(decision.ttlSeconds).toBe(604800);
  });

  it('gives a short TTL to a range that includes restatable days', () => {
    const decision = decideTtl(
      { from: '2026-08-01', to: '2026-08-21' },
      '2026-08-20',
      90,
      300,
      604800
    );
    expect(decision.fullySealed).toBe(false);
    expect(decision.ttlSeconds).toBe(300);
  });
});
