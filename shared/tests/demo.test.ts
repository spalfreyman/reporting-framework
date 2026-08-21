import { describe, expect, it } from 'vitest';
import {
  DEMO_CHANNELS,
  DEMO_SKUS,
  DEMO_STORES,
  currencyForStore,
  demoItemDay,
  demoOrderDay,
  demoWebDay,
  seasonality,
} from '../src/demo/generator.js';

/**
 * The demo generator has to be BELIEVABLE, not just non-empty: the whole point is that a
 * reviewer can open the reports on a bare project and learn something. These tests assert
 * the properties that make it believable, and the determinism the cross-source story
 * depends on.
 */

describe('demo generator', () => {
  it('is deterministic for identical inputs', () => {
    // Cross-source coherence depends on this: the GA4 and ERP mocks generate from the same
    // seed, so both must agree on which days were busy.
    expect(JSON.stringify(demoOrderDay('2026-08-19'))).toBe(
      JSON.stringify(demoOrderDay('2026-08-19'))
    );
    expect(JSON.stringify(demoWebDay('2026-08-19'))).toBe(JSON.stringify(demoWebDay('2026-08-19')));
  });

  it('produces different figures on different days', () => {
    expect(JSON.stringify(demoOrderDay('2026-08-19'))).not.toBe(
      JSON.stringify(demoOrderDay('2026-08-20'))
    );
  });

  it('covers every store and channel combination', () => {
    const rows = demoOrderDay('2026-08-19');
    expect(rows).toHaveLength(DEMO_STORES.length * DEMO_CHANNELS.length);
  });

  it('never mixes currencies within a store', () => {
    // Otherwise a money metric would be incoherent before the framework even got to
    // refusing a cross-currency sum.
    for (const row of demoOrderDay('2026-08-19')) {
      expect(row.currency).toBe(currencyForStore(row.store));
    }
    expect(currencyForStore('uk-manchester-01')).toBe('GBP');
    expect(currencyForStore('de-berlin-01')).toBe('EUR');
  });

  it('keeps net revenue below gross, and discount as the difference', () => {
    for (const row of demoOrderDay('2026-08-19')) {
      expect(row.revenueNet).toBeLessThan(row.revenueGross);
      expect(row.revenueGross - row.discount).toBe(row.revenueNet);
    }
  });

  it('models a Black Friday spike, a weekend lift and a January trough', () => {
    // 2026-11-27 is the last Friday of November.
    const blackFriday = seasonality('2026-11-27');
    const ordinaryTuesday = seasonality('2026-08-18');
    const saturday = seasonality('2026-08-22');
    const january = seasonality('2026-01-13');

    expect(blackFriday).toBeGreaterThan(3);
    expect(saturday).toBeGreaterThan(ordinaryTuesday);
    expect(january).toBeLessThan(ordinaryTuesday);
  });

  it('yields an implied conversion rate in a believable band', () => {
    // A demo where conversion rate reads 40% teaches the reader nothing except distrust.
    for (const day of ['2026-08-19', '2026-03-04', '2026-11-27']) {
      const orders = demoOrderDay(day).reduce((total, row) => total + row.orders, 0);
      const sessions = demoWebDay(day).reduce((total, row) => total + row.sessions, 0);
      const conversionRate = orders / sessions;
      expect(conversionRate).toBeGreaterThan(0.005);
      expect(conversionRate).toBeLessThan(0.06);
    }
  });

  it('produces a monotonically narrowing funnel', () => {
    for (const row of demoWebDay('2026-08-19')) {
      expect(row.productViews).toBeLessThanOrEqual(row.sessions);
      expect(row.addToCarts).toBeLessThanOrEqual(row.productViews);
      expect(row.checkoutStarts).toBeLessThanOrEqual(row.addToCarts);
      expect(row.zeroResultSearches).toBeLessThanOrEqual(row.searches);
      expect(row.newUsers).toBeLessThanOrEqual(row.activeUsers);
    }
  });

  it('restricts item grain to top-N per store, matching the real rollup shape', () => {
    const rows = demoItemDay('2026-08-19', 40);
    expect(rows).toHaveLength(DEMO_STORES.length * 40);
    // Well under the full catalogue, which is the point: full SKU grain is what pushes an
    // installation off the Custom Object tier.
    expect(rows.length).toBeLessThan(DEMO_SKUS.length * DEMO_STORES.length);
  });

  it('keeps unit cost below unit price, so margin is positive', () => {
    for (const row of demoItemDay('2026-08-19', 10)) {
      const unitPrice = row.revenueNet / row.units;
      expect(row.unitCost).toBeLessThan(unitPrice);
      expect(row.returnsUnits).toBeLessThanOrEqual(row.units);
    }
  });

  it('shows a rank decay, so a few SKUs carry most of the volume', () => {
    const rows = demoItemDay('2026-08-19', 40).filter((r) => r.store === DEMO_STORES[0]);
    const head = rows.slice(0, 5).reduce((t, r) => t + r.units, 0);
    const tail = rows.slice(-5).reduce((t, r) => t + r.units, 0);
    expect(head).toBeGreaterThan(tail);
  });
});
