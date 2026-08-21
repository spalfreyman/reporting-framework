import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { dataSourceDescriptorSchema } from '../src/shared/schema/descriptor.js';
import { bearerMatches } from '../src/shared/dsp/server.js';

const SECRET = 'a-sufficiently-long-secret';

const ENV = {
  CTP_PROJECT_KEY: 'demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'view_products view_orders manage_key_value_documents',
  SOURCE_ID: 'ct-native',
  MODE: 'demo',
  ROLLUP_TIMEZONE: 'UTC',
  REPORTING_SHARED_SECRET: SECRET,
  CONNECT_SERVICE_URL: 'https://ct-native.example.commercetools.app/ct-native-source',
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

const BASE = '/ct-native-source';

const query = (over: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  requestId: 'req-1',
  projectKey: 'demo',
  metrics: ['orders.count@orderdate', 'revenue.net@orderdate'],
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
  const req = request(app).post(`${BASE}/query`);
  if (secret) req.set('authorization', `Bearer ${secret}`);
  return req.send(body as object);
};

describe('descriptor', () => {
  it('is valid against the schema the gateway will parse it with', async () => {
    // A malformed descriptor is silently ignored by the gateway, which presents to the
    // operator as "I installed the connector and nothing happened".
    const response = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(() => dataSourceDescriptorSchema.parse(response.body)).not.toThrow();
  });

  it('declares BOTH live and materialized metrics, because commercetools has both', async () => {
    const response = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const descriptor = dataSourceDescriptorSchema.parse(response.body);

    const live = descriptor.capabilities.metrics.filter((m) => m.execution === 'live');
    const materialized = descriptor.capabilities.metrics.filter((m) => m.execution === 'materialized');

    expect(live.map((m) => m.metricId)).toContain('products.count');
    expect(materialized.map((m) => m.metricId)).toContain('orders.count@orderdate');
    // Live facets are a point-in-time snapshot, so they must advertise no time grain.
    expect(live.every((m) => m.grains.length === 0)).toBe(true);
    expect(materialized.every((m) => m.grains.includes('day'))).toBe(true);
  });

  it('declares canonical keys that match the registry, so joins are legal', async () => {
    const response = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const descriptor = dataSourceDescriptorSchema.parse(response.body);
    const byId = new Map(descriptor.capabilities.dimensions.map((d) => [d.dimensionId, d]));

    expect(byId.get('date')?.canonicalKeyDefinition).toBe('iso-8601-date');
    expect(byId.get('store')?.canonicalKeyDefinition).toBe('commercetools:store.key');
    expect(byId.get('product')?.canonicalKeyDefinition).toBe('commercetools:variant.sku');
    // Deliberately NOT conformed: a commercetools sales channel is not a marketing channel.
    expect(byId.get('distributionChannel')?.canonicalKeyDefinition).toBeUndefined();
  });

  it('advertises store scoping, so a scoped subject can actually be served', async () => {
    const response = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const descriptor = dataSourceDescriptorSchema.parse(response.body);
    expect(descriptor.scoping.rowLevelDimensions).toContain('store');
  });

  it('reports demo mode honestly', async () => {
    const response = await request(app).get(`${BASE}/health`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', demoMode: true, mode: 'demo' });
  });
});

describe('authentication', () => {
  it('serves /health without a token, for the liveness probe', async () => {
    expect((await request(app).get(`${BASE}/health`)).status).toBe(200);
  });

  it('rejects /query with no token', async () => {
    const response = await post(query(), null);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UPSTREAM_AUTH');
  });

  it('rejects /query with the wrong token', async () => {
    const response = await post(query(), 'wrong-secret-value-x');
    expect(response.status).toBe(401);
  });

  it('rejects /describe with no token — capabilities are not public', async () => {
    expect((await request(app).get(`${BASE}/describe`)).status).toBe(401);
  });

  it('compares secrets in constant time, and survives a length mismatch', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches('Bearer short', SECRET)).toBe(false);
    expect(bearerMatches(undefined, SECRET)).toBe(false);
  });
});

describe('capability validation', () => {
  it('rejects a metric it does not serve', async () => {
    const response = await post(query({ metrics: ['sessions.count'] }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNSUPPORTED_METRIC');
  });

  it('rejects a dimension it cannot split the metric by', async () => {
    const response = await post(query({ dimensions: ['trafficChannel'] }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNSUPPORTED_DIMENSION');
  });

  it('refuses to mix live catalogue metrics with time-bucketed order metrics', async () => {
    // A point-in-time snapshot and a time series have no common answer.
    const response = await post(
      query({ metrics: ['products.count', 'orders.count@orderdate'] })
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNSUPPORTED_GRAIN');
    expect(response.body.message).toMatch(/no common answer/);
  });

  it('rejects a malformed query rather than guessing', async () => {
    const response = await post({ protocolVersion: 1, metrics: [] });
    expect(response.status).toBe(400);
  });

  it('fails closed when asked to scope by a dimension it cannot enforce', async () => {
    const response = await post(
      query({ scope: { unrestricted: false, businessUnits: ['bu-1'] } })
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SCOPE_UNSATISFIABLE');
  });
});

describe('demo mode', () => {
  it('returns a well-formed, honestly-flagged result set', async () => {
    const response = await post(query());
    expect(response.status).toBe(200);

    expect(response.body.protocolVersion).toBe(1);
    expect(response.body.sourceId).toBe('ct-native');
    expect(response.body.provenance.execution).toBe('materialized');
    // Never pretend generated figures are real.
    expect(response.body.flags.degradedReason).toBe('demo-fixture');
    expect(response.body.rows.length).toBe(7);
  });

  it('labels columns with roles and value types the UI can format from', async () => {
    const response = await post(query());
    const columns = response.body.columns as Array<{ id: string; role: string; valueType: string }>;

    expect(columns.find((c) => c.id === 'date')?.role).toBe('time');
    expect(columns.find((c) => c.id === 'orders.count@orderdate')).toMatchObject({
      role: 'metric',
      valueType: 'count',
    });
    expect(columns.find((c) => c.id === 'revenue.net@orderdate')).toMatchObject({
      role: 'metric',
      valueType: 'money',
    });
  });

  it('produces plausible, internally consistent figures', async () => {
    const response = await post(
      query({ metrics: ['orders.count@orderdate', 'revenue.gross@orderdate', 'revenue.net@orderdate'] })
    );
    const columns = (response.body.columns as Array<{ id: string }>).map((c) => c.id);
    const index = (id: string) => columns.indexOf(id);

    for (const row of response.body.rows as Array<Array<number>>) {
      expect(row[index('orders.count@orderdate')]).toBeGreaterThan(0);
      // Net is always below gross, because a discount was applied.
      expect(row[index('revenue.net@orderdate')]).toBeLessThan(row[index('revenue.gross@orderdate')]);
    }
  });

  it('honours row-level scope, so a scoped user sees a scoped demo', async () => {
    const all = await post(query({ dimensions: ['store'] }));
    const scoped = await post(
      query({
        dimensions: ['store'],
        scope: { unrestricted: false, stores: ['de-berlin-01'] },
      })
    );

    const storesIn = (body: { columns: Array<{ id: string }>; rows: unknown[][] }) => {
      const i = body.columns.findIndex((c) => c.id === 'store');
      return new Set(body.rows.map((row) => String(row[i])));
    };

    expect(storesIn(all.body).size).toBeGreaterThan(1);
    expect([...storesIn(scoped.body)]).toEqual(['de-berlin-01']);
  });

  it('serves live catalogue metrics with no time grain', async () => {
    const response = await post(
      query({
        metrics: ['products.count', 'price.mean'],
        dimensions: ['category'],
        grain: null,
        timeRange: undefined,
      })
    );
    expect(response.status).toBe(200);
    expect(response.body.provenance.execution).toBe('live');
    expect(response.body.flags.grainServed).toBeNull();
    expect(response.body.rows.length).toBeGreaterThan(1);
  });

  it('requires a time range for order metrics', async () => {
    const response = await post(query({ timeRange: undefined, grain: 'day' }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNSUPPORTED_GRAIN');
  });
});
