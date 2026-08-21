import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { dataSourceDescriptorSchema } from '../src/shared/schema/descriptor.js';
import { TokenBucket } from '../src/quota.js';
import { DIMENSION_TO_GA4, ga4DateToIso, isoDateToGa4 } from '../src/translate.js';

const SECRET = 'a-sufficiently-long-secret';
const ENV = {
  CTP_PROJECT_KEY: 'sp-demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'manage_project:sp-demo',
  SOURCE_ID: 'ga4',
  MODE: 'demo',
  GA4_TIMEZONE: 'UTC',
  REPORTING_SHARED_SECRET: SECRET,
  CONNECT_SERVICE_URL: 'https://ga4.example.commercetools.app/ga4-source',
  LOG_LEVEL: 'error',
};

let app: Express;
beforeAll(async () => {
  Object.assign(process.env, ENV);
  const { resetConfiguration } = await import('../src/env.js');
  resetConfiguration();
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

const BASE = '/ga4-source';
const q = (over: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  requestId: 'r1',
  projectKey: 'sp-demo',
  metrics: ['sessions.count'],
  dimensions: [],
  grain: 'day',
  timeRange: { from: '2026-08-13', to: '2026-08-20' },
  timezone: 'UTC',
  filters: [],
  scope: { unrestricted: true },
  orderBy: [],
  limit: 1000,
  budgetMs: 20000,
  ...over,
});
const post = (body: unknown, secret: string | null = SECRET) => {
  const r = request(app).post(`${BASE}/query`);
  if (secret) r.set('authorization', `Bearer ${secret}`);
  return r.send(body as object);
};

describe('descriptor', () => {
  it('validates and advertises web-analytics metrics only', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    expect(d.kind).toBe('web-analytics');
    const ids = d.capabilities.metrics.map((m) => m.metricId);
    expect(ids).toContain('sessions.count');
    // GA4 must NOT claim to serve order/revenue metrics — commercetools owns those.
    expect(ids).not.toContain('revenue.net@orderdate');
    expect(ids).not.toContain('orders.count@orderdate');
  });

  it('marks every metric sampled — GA4 figures are modelled, not exact', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    expect(d.capabilities.metrics.every((m) => m.exactness === 'sampled')).toBe(true);
  });

  it('conforms date/country/device but NOT the web-only dimensions', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    const byId = new Map(d.capabilities.dimensions.map((x) => [x.dimensionId, x]));
    expect(byId.get('country')?.canonicalKeyDefinition).toBe('iso-3166-1-alpha2');
    expect(byId.get('device')?.canonicalKeyDefinition).toBe('device-category:desktop|mobile|tablet');
    // trafficChannel deliberately has no canonical key: it must never join to a CT channel.
    expect(byId.get('trafficChannel')?.canonicalKeyDefinition).toBeUndefined();
  });

  it('cannot enforce commercetools row scope, so it declares none (fails closed later)', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    expect(d.scoping.rowLevelDimensions).toEqual([]);
  });
});

describe('translation', () => {
  it('maps country to countryId (ISO code), not the display-name dimension', () => {
    // The subtle one: GA4 `country` returns "Germany"; `countryId` returns "DE", which is
    // what joins to a commercetools country.
    expect(DIMENSION_TO_GA4.country).toBe('countryId');
    expect(DIMENSION_TO_GA4.device).toBe('deviceCategory');
  });

  it('round-trips GA4 compact dates and ISO dates', () => {
    expect(ga4DateToIso('20260819')).toBe('2026-08-19');
    expect(isoDateToGa4('2026-08-19')).toBe('20260819');
  });
});

describe('token bucket', () => {
  it('spends tokens and refuses when empty', () => {
    const bucket = new TokenBucket(2, 60, () => 1_000_000);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('refills over time', () => {
    let clock = 0;
    const bucket = new TokenBucket(10, 60, () => clock); // 60/hour = 1/min
    for (let i = 0; i < 10; i += 1) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);
    clock += 5 * 60_000; // 5 minutes → ~5 tokens back
    expect(bucket.available).toBeGreaterThanOrEqual(4);
  });
});

describe('demo mode', () => {
  it('serves believable session figures flagged as demo', async () => {
    const res = await post(q({ metrics: ['sessions.count', 'addtocart.count'] }));
    expect(res.status).toBe(200);
    expect(res.body.provenance.execution).toBe('live');
    expect(res.body.flags.degradedReason).toBe('demo-fixture');
    expect(res.body.rowCount).toBe(7);
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    const si = cols.indexOf('sessions.count');
    // Every day should have a positive, plausible session count.
    for (const row of res.body.rows) expect(row[si]).toBeGreaterThan(0);
  });

  it('produces a funnel that only ever narrows', async () => {
    const res = await post(
      q({ metrics: ['sessions.count', 'addtocart.count', 'checkoutstart.count'] })
    );
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    const [s, a, c] = ['sessions.count', 'addtocart.count', 'checkoutstart.count'].map((m) => cols.indexOf(m));
    const total = (i: number) => res.body.rows.reduce((sum: number, r: number[]) => sum + r[i], 0);
    expect(total(a)).toBeLessThan(total(s));
    expect(total(c)).toBeLessThan(total(a));
  });

  it('splits by a conformed dimension (device)', async () => {
    const res = await post(q({ dimensions: ['device'], metrics: ['sessions.count'] }));
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    expect(cols).toContain('device');
    const di = cols.indexOf('device');
    const devices = new Set(res.body.rows.map((r: string[]) => r[di]));
    expect([...devices].sort()).toEqual(['desktop', 'mobile', 'tablet']);
  });

  it('gives a cross-source conversion rate in a believable band', async () => {
    // The headline: GA4 sessions ÷ the 63 real commercetools orders would be the gateway's
    // job, but the demo sessions must at least be the right order of magnitude for orders/day.
    const res = await post(q({ metrics: ['sessions.count'] }));
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    const si = cols.indexOf('sessions.count');
    const perDay = res.body.rows.map((r: number[]) => r[si]);
    // Sessions/day should be in the thousands, so a handful of orders/day gives a ~0.x–few %
    // conversion rate rather than a nonsensical one.
    for (const v of perDay) {
      expect(v).toBeGreaterThan(500);
      expect(v).toBeLessThan(200_000);
    }
  });
});

describe('auth + capability', () => {
  it('rejects /query without the shared secret', async () => {
    expect((await post(q(), null)).status).toBe(401);
  });

  it('rejects a metric it does not serve', async () => {
    const res = await post(q({ metrics: ['revenue.net@orderdate'] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_METRIC');
  });

  it('serves /health unauthenticated with the token count', async () => {
    const res = await request(app).get(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('demo');
    expect(typeof res.body.tokensAvailable).toBe('number');
  });
});
