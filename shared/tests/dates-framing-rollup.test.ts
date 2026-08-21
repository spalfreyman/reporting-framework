import { describe, expect, it } from 'vitest';
import {
  addDays,
  bucketDay,
  eachDay,
  rangeLengthDays,
  resolveComparison,
  resolvePreset,
  splitSealedHot,
} from '../src/util/date-range.js';
import {
  DEFAULT_POLICIES,
  activeScopeDimensions,
  canSeeMetric,
  partitionRequestedMetrics,
  resolveAccess,
  type AccessPolicy,
  type Subject,
} from '../src/framing/access.js';
import {
  CELLS_PER_OBJECT,
  dayPartitionKey,
  estimateCardinality,
  parseDayPartitionKey,
  shardCells,
  topNWithResidual,
} from '../src/rollup/keying.js';

describe('date ranges', () => {
  it('treats ranges as half-open, so a single day has length 1', () => {
    // Every off-by-one-day bug in reporting comes from inclusive upper bounds.
    expect(rangeLengthDays({ from: '2026-08-19', to: '2026-08-20' })).toBe(1);
    expect(eachDay({ from: '2026-08-19', to: '2026-08-21' })).toEqual(['2026-08-19', '2026-08-20']);
  });

  it('is DST-safe across a spring-forward boundary', () => {
    // Adding 24h to a local time would skip or repeat a day; UTC-midnight arithmetic does not.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(eachDay({ from: '2026-03-28', to: '2026-03-31' })).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
  });

  it('excludes the partial current day from trailing windows', () => {
    expect(resolvePreset('last7d', '2026-08-20')).toEqual({ from: '2026-08-13', to: '2026-08-20' });
    expect(resolvePreset('last28d', '2026-08-20')).toEqual({ from: '2026-07-23', to: '2026-08-20' });
  });

  it('includes the current day in to-date windows', () => {
    expect(resolvePreset('mtd', '2026-08-20')).toEqual({ from: '2026-08-01', to: '2026-08-21' });
    expect(resolvePreset('ytd', '2026-08-20')).toEqual({ from: '2026-01-01', to: '2026-08-21' });
    // 2026-08-20 is a Thursday; Monday-start week begins 2026-08-17.
    expect(resolvePreset('wtd', '2026-08-20')).toEqual({ from: '2026-08-17', to: '2026-08-21' });
  });

  it('starts quarters on the right month', () => {
    expect(resolvePreset('qtd', '2026-08-20').from).toBe('2026-07-01');
    expect(resolvePreset('qtd', '2026-02-10').from).toBe('2026-01-01');
    expect(resolvePreset('qtd', '2026-11-05').from).toBe('2026-10-01');
  });

  it('shifts previousPeriod to the immediately preceding window', () => {
    const range = { from: '2026-08-13', to: '2026-08-20' };
    expect(resolveComparison(range, 'previousPeriod')).toEqual({
      from: '2026-08-06',
      to: '2026-08-13',
    });
  });

  it('shifts previousYear by 364 days so weekdays stay aligned', () => {
    // 365 would compare a Thursday to a Wednesday, which breaks like-for-like trading.
    const range = { from: '2026-08-13', to: '2026-08-20' };
    const comparison = resolveComparison(range, 'previousYear', 'weekday')!;
    expect(rangeLengthDays(comparison)).toBe(7);
    const dayOfWeek = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
    expect(dayOfWeek(comparison.from)).toBe(dayOfWeek(range.from));
  });

  it('shifts previousYear by calendar date when asked', () => {
    const comparison = resolveComparison(
      { from: '2026-08-13', to: '2026-08-20' },
      'previousYear',
      'date'
    );
    expect(comparison).toEqual({ from: '2025-08-13', to: '2025-08-20' });
  });

  it('buckets days into the start of their grain period', () => {
    expect(bucketDay('2026-08-20', 'week')).toBe('2026-08-17'); // Thursday -> Monday
    expect(bucketDay('2026-08-20', 'week', 'sunday')).toBe('2026-08-16');
    expect(bucketDay('2026-08-20', 'month')).toBe('2026-08-01');
    expect(bucketDay('2026-08-20', 'quarter')).toBe('2026-07-01');
    expect(bucketDay('2026-08-20', 'year')).toBe('2026-01-01');
  });

  it('splits a range at the sealed boundary', () => {
    const split = splitSealedHot({ from: '2026-01-01', to: '2026-08-21' }, '2026-08-20', 90);
    expect(split.sealed).toEqual({ from: '2026-01-01', to: '2026-05-22' });
    expect(split.hot).toEqual({ from: '2026-05-22', to: '2026-08-21' });
  });

  it('rejects a malformed date rather than silently producing NaN', () => {
    expect(() => addDays('20-08-2026', 1)).toThrow(/Expected YYYY-MM-DD/);
  });
});

describe('access framing', () => {
  const subject = (permissions: string[]): Subject => ({
    id: 'user-1',
    permissions,
    projectKey: 'demo',
    locale: 'en',
  });

  it('hides financial metrics from a plain reporting viewer', () => {
    const access = resolveAccess(subject(['canViewReporting']), DEFAULT_POLICIES, null);
    expect(canSeeMetric(access, 'revenue.net@orderdate')).toBe(true);
    expect(canSeeMetric(access, 'units.sold@orderdate')).toBe(true);
    expect(canSeeMetric(access, 'margin.gross@orderdate')).toBe(false);
    expect(canSeeMetric(access, 'cost.goods@orderdate')).toBe(false);
  });

  it('grants financial metrics with the financials permission', () => {
    const access = resolveAccess(
      subject(['canViewReporting', 'canViewReportingFinancials']),
      DEFAULT_POLICIES,
      null
    );
    expect(canSeeMetric(access, 'margin.gross@orderdate')).toBe(true);
    expect(canSeeMetric(access, 'roas')).toBe(true);
  });

  it('separates denied metrics from unknown ones so client bugs surface', () => {
    const access = resolveAccess(subject(['canViewReporting']), DEFAULT_POLICIES, null);
    const result = partitionRequestedMetrics(access, [
      'revenue.net@orderdate',
      'margin.gross@orderdate',
      'not.a.metric',
    ]);
    expect(result.allowed).toEqual(['revenue.net@orderdate']);
    expect(result.denied).toEqual(['margin.gross@orderdate']);
    expect(result.unknown).toEqual(['not.a.metric']);
  });

  it('fails closed: a scope policy with no assignment yields no data, not all data', () => {
    const storeScoped: AccessPolicy = {
      key: 'store-manager',
      priority: 300,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: [] },
      rowScope: { dimension: 'stores', from: 'assignment' },
    };
    const access = resolveAccess(
      subject(['canViewReporting']),
      [...DEFAULT_POLICIES, storeScoped],
      null
    );
    expect(access.unrestricted).toBe(false);
    expect(access.rowScope.stores).toEqual([]);
  });

  it('applies an assigned store scope and reports it as an active scope dimension', () => {
    const storeScoped: AccessPolicy = {
      key: 'store-manager',
      priority: 300,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: [] },
      rowScope: { dimension: 'stores', from: 'assignment' },
    };
    const access = resolveAccess(subject(['canViewReporting']), [...DEFAULT_POLICIES, storeScoped], {
      subjectId: 'user-1',
      scope: { stores: ['de-berlin-01'], unrestricted: false },
    });
    expect(access.rowScope.stores).toEqual(['de-berlin-01']);
    expect(activeScopeDimensions(access.rowScope)).toEqual(['store']);
  });

  it('intersects multiple scope policies, taking the most restrictive', () => {
    const wide: AccessPolicy = {
      key: 'region',
      priority: 300,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: [] },
      rowScope: { dimension: 'stores', from: 'literal', values: ['a', 'b', 'c'] },
    };
    const narrow: AccessPolicy = {
      key: 'store',
      priority: 400,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: [] },
      rowScope: { dimension: 'stores', from: 'literal', values: ['b'] },
    };
    const access = resolveAccess(subject(['canViewReporting']), [wide, narrow], null);
    expect(access.rowScope.stores).toEqual(['b']);
  });

  it('produces a scope hash that differs between scopes', () => {
    const unrestricted = resolveAccess(subject(['canViewReporting']), DEFAULT_POLICIES, null);
    const scoped = resolveAccess(
      subject(['canViewReporting']),
      [
        ...DEFAULT_POLICIES,
        {
          key: 's',
          priority: 300,
          match: { anyPermission: ['canViewReporting'] },
          grant: { capabilities: [] },
          rowScope: { dimension: 'stores', from: 'literal', values: ['x'] },
        },
      ],
      null
    );
    expect(unrestricted.hash).not.toBe(scoped.hash);
  });

  it('treats an explicit deny as absolute, even against a higher-priority grant', () => {
    const denying: AccessPolicy = {
      key: 'deny-margin',
      priority: 100,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: [] },
      deny: { capabilities: ['metric:margin.gross@orderdate'] },
    };
    const granting: AccessPolicy = {
      key: 'grant-margin',
      priority: 900,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: ['sensitivity:financials', 'metric:margin.gross@orderdate'] },
    };
    const access = resolveAccess(
      subject(['canViewReporting']),
      [...DEFAULT_POLICIES, denying, granting],
      null
    );
    expect(canSeeMetric(access, 'margin.gross@orderdate')).toBe(false);
    // Other financial metrics are still granted — the deny is targeted, not a blanket.
    expect(canSeeMetric(access, 'margin.rate@orderdate')).toBe(true);
  });

  it('does not let a wildcard metric grant cover a sensitive metric', () => {
    // This is what makes handing out 'metric:*' to every reporting viewer safe.
    const wildcardOnly: AccessPolicy = {
      key: 'wildcard',
      priority: 100,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: ['metric:*'] },
    };
    const access = resolveAccess(subject(['canViewReporting']), [wildcardOnly], null);
    expect(canSeeMetric(access, 'revenue.net@orderdate')).toBe(true);
    expect(canSeeMetric(access, 'margin.gross@orderdate')).toBe(false);
    expect(canSeeMetric(access, 'cost.goods@orderdate')).toBe(false);
  });

  it('allows a sensitive metric to be granted by name without the whole group', () => {
    const byName: AccessPolicy = {
      key: 'one-metric',
      priority: 200,
      match: { anyPermission: ['canViewReporting'] },
      grant: { capabilities: ['metric:margin.gross@orderdate'] },
    };
    const access = resolveAccess(subject(['canViewReporting']), [...DEFAULT_POLICIES, byName], null);
    expect(canSeeMetric(access, 'margin.gross@orderdate')).toBe(true);
    expect(canSeeMetric(access, 'cost.goods@orderdate')).toBe(false);
  });
});

describe('rollup keying and the cardinality guard', () => {
  it('round-trips day partition keys, including shards', () => {
    expect(dayPartitionKey('2026-08-19')).toBe('v1_d2026-08-19');
    expect(dayPartitionKey('2026-08-19', 3)).toBe('v1_d2026-08-19_p3');
    expect(parseDayPartitionKey('v1_d2026-08-19')).toEqual({ day: '2026-08-19', shard: 0 });
    expect(parseDayPartitionKey('v1_d2026-08-19_p3')).toEqual({ day: '2026-08-19', shard: 3 });
    expect(parseDayPartitionKey('nonsense')).toBeNull();
  });

  it('keeps a modest cube comfortably on the Custom Object tier', () => {
    // 3 stores x 1 currency x 2 channels x 5 countries x 4 states = 120 rows/day
    const estimate = estimateCardinality(
      { store: 3, currency: 1, channel: 2, country: 5, orderState: 4 },
      365 * 3
    );
    expect(estimate.rowsPerDay).toBe(120);
    expect(estimate.shardsPerDay).toBe(1);
    expect(estimate.withinBudget).toBe(true);
    expect(estimate.recommendation).toBe('custom-objects');
  });

  it('pushes a high-cardinality item-grain cube to the warehouse tier', () => {
    // 50,000 SKUs x 20 stores = 1,000,000 rows/day. This is the footgun the pre-flight
    // estimate exists to refuse.
    const estimate = estimateCardinality({ sku: 50000, store: 20 }, 365 * 3);
    expect(estimate.rowsPerDay).toBe(1_000_000);
    expect(estimate.withinBudget).toBe(false);
    expect(estimate.recommendation).toBe('warehouse');
    expect(estimate.reasons.join(' ')).toMatch(/rows\/day/);
  });

  it('shows day partitioning beating one-object-per-row by orders of magnitude', () => {
    const estimate = estimateCardinality(
      { store: 20, currency: 3, channel: 3, country: 10, orderState: 4 },
      365 * 3
    );
    expect(estimate.rowsPerDay).toBe(7200);
    // The whole argument for day partitioning, in one assertion.
    expect(estimate.objectsForRetention).toBeLessThan(estimate.naiveObjectsForRetention / 100);
  });

  it('shards cells deterministically so a rebuild is a no-op', () => {
    const cells = Array.from({ length: CELLS_PER_OBJECT + 5 }, (_, i) => ({
      k: { sku: `s${i}` },
      m: { units: i },
    }));
    const first = shardCells(cells);
    const second = shardCells(cells);
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveLength(CELLS_PER_OBJECT);
    expect(first[1]).toHaveLength(5);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('always returns at least one shard for an empty day', () => {
    expect(shardCells([])).toEqual([[]]);
  });

  it('collapses the tail into an __other__ residual that preserves the total', () => {
    const cells = [
      { k: { sku: 'a' }, m: { units: 100, revenueNet: 1000 } },
      { k: { sku: 'b' }, m: { units: 50, revenueNet: 500 } },
      { k: { sku: 'c' }, m: { units: 10, revenueNet: 100 } },
      { k: { sku: 'd' }, m: { units: 5, revenueNet: 50 } },
    ];
    const reduced = topNWithResidual(cells, 'units', 2, { sku: '__other__' });
    expect(reduced).toHaveLength(3);
    const residual = reduced[2];
    expect(residual.k.sku).toBe('__other__');
    expect(residual.m.units).toBe(15);
    expect(residual.m.revenueNet).toBe(150);

    const totalBefore = cells.reduce((t, c) => t + c.m.units, 0);
    const totalAfter = reduced.reduce((t, c) => t + (c.m.units ?? 0), 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it('leaves a cell list alone when it already fits within N', () => {
    const cells = [{ k: { sku: 'a' }, m: { units: 1 } }];
    expect(topNWithResidual(cells, 'units', 5, { sku: '__other__' })).toEqual(cells);
  });
});
