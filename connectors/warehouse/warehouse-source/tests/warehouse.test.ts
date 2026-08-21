import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { compileQuery } from '../src/compile-query.js';
import { TEMPLATES } from '../src/sql/manifest.js';
import { dataSourceDescriptorSchema } from '../src/shared/schema/descriptor.js';
import type { SourceQuery } from '../src/shared/schema/query.js';

const SECRET = 'a-sufficiently-long-secret';
const ENV = {
  CTP_PROJECT_KEY: 'sp-demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'manage_project:sp-demo',
  SOURCE_ID: 'warehouse',
  WAREHOUSE_KIND: 'postgres',
  MODE: 'demo',
  WAREHOUSE_TIMEZONE: 'UTC',
  REPORTING_SHARED_SECRET: SECRET,
  CONNECT_SERVICE_URL: 'https://warehouse.example.commercetools.app/warehouse-source',
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

const q = (over: Partial<SourceQuery> = {}): SourceQuery =>
  ({
    protocolVersion: 1,
    requestId: 'r1',
    projectKey: 'sp-demo',
    metrics: ['cost.goods@orderdate', 'revenue.net@orderdate'],
    dimensions: ['product'],
    grain: 'day',
    timeRange: { from: '2026-08-01', to: '2026-08-08' },
    timezone: 'UTC',
    filters: [],
    scope: { unrestricted: true },
    orderBy: [],
    limit: 1000,
    budgetMs: 20000,
    ...over,
  }) as SourceQuery;

const BASE = '/warehouse-source';
const post = (body: unknown, secret: string | null = SECRET) => {
  const r = request(app).post(`${BASE}/query`);
  if (secret) r.set('authorization', `Bearer ${secret}`);
  return r.send(body as object);
};

// ── The security core ─────────────────────────────────────────────────────────

describe('SQL compilation is injection-proof', () => {
  it('rejects a dimension that is not on the allowlist BEFORE any SQL is built', () => {
    // The whole point: an attacker-supplied dimension can never reach an identifier.
    expect(() =>
      compileQuery(q({ dimensions: ['product; DROP TABLE reporting_order_lines; --'] }), 50000)
    ).toThrow(/No warehouse template serves|cannot group by/);
  });

  it('rejects a metric no template serves, rather than improvising SQL', () => {
    expect(() => compileQuery(q({ metrics: ['sessions.count'] }), 50000)).toThrow(
      /No warehouse template serves/
    );
  });

  it('only ever binds VALUES as parameters — the SQL text is fixed per template', () => {
    const compiled = compileQuery(q(), 50000);
    // Params are the date range and the limit — never a metric or dimension name.
    expect(compiled.params).toEqual(['2026-08-01', '2026-08-08', 1000]);
    // The from/to dates do NOT appear inline in the SQL text.
    expect(compiled.sql).not.toContain('2026-08-01');
    expect(compiled.sql).toContain('$1');
    expect(compiled.sql).toContain('$2');
  });

  it('maps a dimension to its FIXED column, not the requested id', () => {
    const compiled = compileQuery(q({ dimensions: ['store', 'product'] }), 50000);
    // Column names come from the manifest allowlist (store_key, sku), not "store"/"product".
    expect(compiled.sql).toContain('store_key');
    expect(compiled.sql).toContain('sku');
  });

  it('clamps the limit to MAX_ROWS', () => {
    const compiled = compileQuery(q({ limit: 999_999 }), 50000);
    expect(compiled.params[2]).toBe(50000);
  });

  it('every template selects each metric with a quoted alias matching its semantic id', () => {
    // So the handler can map result columns back to metric ids without guessing.
    for (const template of TEMPLATES) {
      const sql = template.sql([]);
      for (const metric of template.metrics) {
        expect(sql).toContain(`"${metric}"`);
      }
    }
  });
});

// ── descriptor ──────────────────────────────────────────────────────────────

describe('descriptor', () => {
  it('validates and advertises the scale-tier metrics commercetools lacks', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    const ids = d.capabilities.metrics.map((m) => m.metricId);
    expect(ids).toContain('cost.goods@orderdate');
    expect(ids).toContain('marketing.spend');
    // Product grain is what makes it the scale tier.
    const cost = d.capabilities.metrics.find((m) => m.metricId === 'cost.goods@orderdate');
    expect(cost?.dimensions).toContain('product');
  });

  it('can enforce store scope (its tables are keyed on store)', async () => {
    const res = await request(app).get(`${BASE}/describe`).set('authorization', `Bearer ${SECRET}`);
    const d = dataSourceDescriptorSchema.parse(res.body);
    expect(d.scoping.rowLevelDimensions).toContain('store');
  });
});

// ── demo mode ─────────────────────────────────────────────────────────────────

describe('demo mode', () => {
  it('serves cost and revenue per SKU, flagged as demo', async () => {
    const res = await post(q());
    expect(res.status).toBe(200);
    expect(res.body.flags.degradedReason).toBe('demo-fixture');
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    expect(cols).toContain('product');
    expect(cols).toContain('cost.goods@orderdate');
    expect(res.body.rowCount).toBeGreaterThan(0);
  });

  it('produces cost below revenue, so gross margin is positive', async () => {
    const res = await post(q({ dimensions: [] }));
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    const ci = cols.indexOf('cost.goods@orderdate');
    const ri = cols.indexOf('revenue.net@orderdate');
    for (const row of res.body.rows) expect(row[ci]).toBeLessThan(row[ri]);
  });

  it('serves marketing spend split by channel', async () => {
    const res = await post(
      q({ metrics: ['marketing.spend'], dimensions: ['channel'] })
    );
    expect(res.status).toBe(200);
    const cols = res.body.columns.map((c: { id: string }) => c.id);
    expect(cols).toContain('channel');
    expect(cols).toContain('marketing.spend');
    for (const row of res.body.rows) expect(row[cols.indexOf('marketing.spend')]).toBeGreaterThan(0);
  });

  it('rejects an unserved metric over HTTP with a capability error', async () => {
    const res = await post(q({ metrics: ['sessions.count'] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_METRIC');
  });

  it('rejects /query without the shared secret', async () => {
    expect((await post(q(), null)).status).toBe(401);
  });
});
