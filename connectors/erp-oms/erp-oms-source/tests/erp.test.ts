import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { dataSourceDescriptorSchema } from '../src/shared/schema/descriptor.js';
import { fakeFulfilment, fakeInventory, fakeReturns } from '../src/shared/demo/fake-erp.js';
import type { SourceQuery } from '../src/shared/schema/query.js';

const SECRET = 'a-sufficiently-long-secret';
const ENV = {
  CTP_PROJECT_KEY: 'sp-demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'manage_project:sp-demo',
  SOURCE_ID: 'erp-oms',
  MODE: 'demo',
  ERP_TIMEZONE: 'UTC',
  REPORTING_SHARED_SECRET: SECRET,
  CONNECT_SERVICE_URL: 'https://erp.example.commercetools.app/erp-oms-source',
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

const BASE = '/erp-oms-source';
const q = (over: Partial<SourceQuery> = {}): SourceQuery =>
  ({
    protocolVersion: 1,
    requestId: 'r1',
    projectKey: 'sp-demo',
    metrics: ['shipments.count', 'shipments.onTime'],
    dimensions: ['warehouse'],
    grain: 'day',
    timeRange: { from: '2026-08-01', to: '2026-08-08' },
    timezone: 'UTC',
    filters: [],
    scope: { unrestricted: true },
    orderBy: [],
    limit: 5000,
    budgetMs: 20000,
    ...over,
  }) as SourceQuery;
const post = (body: unknown, secret: string | null = SECRET) => {
  const r = request(app).post(`${BASE}/query`);
  if (secret) r.set('authorization', `Bearer ${secret}`);
  return r.send(body as object);
};

describe('fake ERP', () => {
  it('is deterministic for a given day', () => {
    expect(JSON.stringify(fakeFulfilment('2026-08-01', '2026-08-02'))).toBe(
      JSON.stringify(fakeFulfilment('2026-08-01', '2026-08-02'))
    );
  });

  it('keeps on-time shipments at or below total shipments', () => {
    for (const row of fakeFulfilment('2026-08-01', '2026-08-07')) {
      expect(row.onTime).toBeLessThanOrEqual(row.shipments);
    }
  });

  it('gives positive on-hand stock and weeks of cover', () => {
    for (const row of fakeInventory('2026-08-07', '2026-08-08')) {
      expect(row.onHand).toBeGreaterThan(0);
      expect(row.weeksCover).toBeGreaterThan(0);
    }
  });

  it('produces a spread of return reasons', () => {
    const reasons = new Set(fakeReturns('2026-08-01', '2026-08-02').map((r) => r.reason));
    expect(reasons.size).toBeGreaterThan(1);
  });
});

describe('descriptor', () => {
  it('validates and is the system of record for fulfilment/stock', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    expect(d.kind).toBe('erp');
    expect(d.provenance.systemOfRecord).toBe(true);
    const ids = d.capabilities.metrics.map((m) => m.metricId);
    expect(ids).toContain('inventory.available');
    expect(ids).toContain('shipments.onTime');
    expect(ids).toContain('returns.units@orderdate');
  });

  it('advertises inventory as point-in-time (no time grain)', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    const inv = d.capabilities.metrics.find((m) => m.metricId === 'inventory.available');
    expect(inv?.grains).toEqual([]);
  });

  it('reports daily freshness, so the UI does not imply real-time', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    expect(d.freshness.updateFrequency).toBe('daily');
  });
});

describe('demo query', () => {
  it('serves fulfilment by warehouse, flagged demo', async () => {
    const res = await post(q());
    expect(res.status).toBe(200);
    expect(res.body.flags.degradedReason).toBe('demo-fixture');
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    expect(cols).toContain('warehouse');
    expect(cols).toContain('shipments.count');
    expect(res.body.rowCount).toBeGreaterThan(0);
  });

  it('serves inventory as a point-in-time snapshot with no date column', async () => {
    const res = await post(
      q({ metrics: ['inventory.available'], dimensions: ['warehouse'], grain: null })
    );
    expect(res.status).toBe(200);
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    expect(cols).not.toContain('date');
    expect(res.body.flags.grainServed).toBeNull();
  });

  it('refuses to mix datasets with different grains in one query', async () => {
    // inventory (point-in-time) + shipments (daily) have no common answer. The shared
    // harness's grain guard catches it first (inventory advertises no grain), which is the
    // same mechanism ct-native uses.
    const res = await post(q({ metrics: ['inventory.available', 'shipments.count'] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_GRAIN');
  });

  it('serves returns by reason', async () => {
    const res = await post(q({ metrics: ['returns.units@orderdate'], dimensions: ['returnReason'] }));
    expect(res.status).toBe(200);
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    expect(cols).toContain('returnReason');
  });

  it('rejects a metric it does not serve', async () => {
    const res = await post(q({ metrics: ['sessions.count'] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_METRIC');
  });

  it('rejects /query without the shared secret', async () => {
    expect((await post(q(), null)).status).toBe(401);
  });
});
