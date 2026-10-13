import { describe, expect, it, beforeEach } from './harness.js';
import { buildDescriptor } from '../src/descriptor.js';
import { isProductSearchUnavailable } from '../src/ct/live-facets.js';
import { resetConfiguration } from '../src/env.js';

/**
 * The connector must advertise only what the project can actually serve. On sp-demo,
 * Product Search is not activated, so the descriptor must omit the live catalogue metrics
 * rather than advertise metrics that would 404 on every query.
 */

const ENV = {
  CTP_PROJECT_KEY: 'sp-demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'manage_project:sp-demo',
  SOURCE_ID: 'ct-native',
  ROLLUP_TIMEZONE: 'UTC',
  REPORTING_SHARED_SECRET: 'a-sufficiently-long-secret',
  CONNECT_SERVICE_URL: 'https://ct-native.example.commercetools.app/ct-native-source',
};

const liveIds = (available: boolean) => {
  resetConfiguration();
  Object.assign(process.env, { ...ENV, MODE: 'live' });
  return buildDescriptor({ productSearchAvailable: available }).capabilities.metrics
    .filter((m) => m.execution === 'live')
    .map((m) => m.metricId);
};

describe('descriptor honesty about Product Search', () => {
  beforeEach(() => resetConfiguration());

  it('omits the Product-Search catalogue metrics when Product Search is unavailable', () => {
    // The whole framework relies on a source advertising only what it can serve. The facet
    // metrics come from Product Search, so they must disappear when it is not activated.
    const ids = liveIds(false);
    expect(ids).not.toContain('products.count');
    expect(ids).not.toContain('price.mean');
    expect(ids).not.toContain('variants.count');
  });

  it('still advertises inventory.available when Product Search is unavailable (it reads InventoryEntry)', () => {
    // inventory.available is served from the core InventoryEntry API, not Product Search, so
    // stock reporting must work on a project (like sp-demo) where Product Search is off.
    expect(liveIds(false)).toContain('inventory.available');
  });

  it('grains inventory.available by supplyChannel/product/category, never by store', () => {
    // A supply channel can belong to several stores, so a store breakdown would double-count
    // stock. supplyChannel is the one unambiguous native stock location.
    resetConfiguration();
    Object.assign(process.env, { ...ENV, MODE: 'live' });
    const inv = buildDescriptor({ productSearchAvailable: false }).capabilities.metrics.find(
      (m) => m.metricId === 'inventory.available'
    );
    expect(inv?.dimensions.sort()).toEqual(['category', 'product', 'supplyChannel']);
  });

  it('advertises live catalogue metrics when Product Search is available', () => {
    expect(liveIds(true)).toContain('products.count');
    expect(liveIds(true)).toContain('price.mean');
  });

  it('declares a low per-metric max lag on live metrics so near-real-time reports accept them', () => {
    // Without this, the source-level maxLag (the order rollup's lag) would reject live
    // catalogue metrics for a report demanding <=300s freshness (e.g. catalogue-health).
    resetConfiguration();
    Object.assign(process.env, { ...ENV, MODE: 'live' });
    const live = buildDescriptor({ productSearchAvailable: true }).capabilities.metrics.filter(
      (m) => m.execution === 'live'
    );
    expect(live.length).toBeGreaterThan(0);
    for (const m of live) {
      expect(m.maxLagSeconds !== undefined && m.maxLagSeconds <= 300).toBe(true);
    }
  });

  it('still advertises the order metrics regardless of Product Search', () => {
    resetConfiguration();
    Object.assign(process.env, { ...ENV, MODE: 'live' });
    const materialized = buildDescriptor({ productSearchAvailable: false }).capabilities.metrics
      .filter((m) => m.execution === 'materialized')
      .map((m) => m.metricId);
    expect(materialized).toContain('orders.count@orderdate');
    expect(materialized).toContain('revenue.net@orderdate');
  });

  it('always advertises catalogue metrics in demo mode, since it serves fixtures', () => {
    resetConfiguration();
    Object.assign(process.env, { ...ENV, MODE: 'demo' });
    // productSearchAvailable is irrelevant in demo mode — fixtures need no live index.
    const live = buildDescriptor({ productSearchAvailable: false }).capabilities.metrics.filter(
      (m) => m.execution === 'live'
    );
    expect(live.length).toBeGreaterThan(0);
  });
});

describe('Product Search availability detection', () => {
  it('reads a 404 as unavailable', () => {
    expect(isProductSearchUnavailable({ statusCode: 404 })).toBe(true);
  });

  it('reads the misleading "does not exist" body as unavailable', () => {
    // The endpoint returns this on an unprovisioned project even though the project exists.
    expect(
      isProductSearchUnavailable({ statusCode: 404, body: { message: 'Project "x" does not exist' } })
    ).toBe(true);
  });

  it('does NOT read a transient 503 as the feature being absent', () => {
    // A blip must not permanently strip catalogue metrics from the descriptor.
    expect(isProductSearchUnavailable({ statusCode: 503 })).toBe(false);
  });
});
