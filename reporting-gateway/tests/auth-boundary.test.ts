import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * The auth boundary.
 *
 * The JWT signature check itself belongs to @commercetools-backend/express (RS256 against
 * the Merchant Center's JWKS), so what is worth testing here is the WIRING around it — the
 * part we own and the part that has actually been wrong:
 *
 *  - /status must be reachable without a session, or Connect's liveness probe fails.
 *  - Every other route must be unreachable without one.
 *  - An auth failure must be 401, never 500. The verifier throws plain Errors for a missing
 *    proxy header, a missing bearer token, a bad signature, a wrong audience and an expired
 *    token alike; left unmapped they surface as 500, which pages someone for what is really
 *    an unauthenticated request and invites a stack trace into the response body.
 *  - No response may leak a stack trace or an upstream message.
 */

const ENV = {
  CTP_PROJECT_KEY: 'demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'view_orders manage_key_value_documents',
  CLOUD_IDENTIFIER: 'gcp-eu',
  CONNECT_SERVICE_URL: 'https://svc-abc.europe-west1.gcp.commercetools.app/gateway',
  REPORTING_SHARED_SECRET: 'a-sufficiently-long-secret',
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

const PROXY_HEADERS = {
  'x-mc-api-cloud-identifier': 'gcp-eu',
  'x-mc-api-forward-to-version': 'v2',
};

/** A structurally valid but unsigned token — the classic alg:none attempt. */
const ALG_NONE = 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9.';

describe('auth boundary', () => {
  it('serves /status without a session, for the liveness probe', async () => {
    const response = await request(app).get('/gateway/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'reporting-gateway' });
  });

  const protectedRoutes: Array<[string, 'get' | 'post']> = [
    ['/gateway/reports', 'get'],
    ['/gateway/datasources', 'get'],
    ['/gateway/reports/trading-dashboard/run', 'post'],
    ['/gateway/reports/preview', 'post'],
  ];

  for (const [route, method] of protectedRoutes) {
    it(`rejects ${method.toUpperCase()} ${route} with no credentials at all`, async () => {
      const response = await (method === 'get' ? request(app).get(route) : request(app).post(route));
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHENTICATED');
    });
  }

  const rejectionMatrix: Array<[string, Record<string, string>]> = [
    ['missing authorization header', { ...PROXY_HEADERS }],
    ['missing proxy cloud-identifier header', { authorization: ALG_NONE }],
    [
      'missing proxy forward-to-version header',
      { authorization: ALG_NONE, 'x-mc-api-cloud-identifier': 'gcp-eu' },
    ],
    ['alg:none forged token', { ...PROXY_HEADERS, authorization: ALG_NONE }],
    ['token that is not a JWT at all', { ...PROXY_HEADERS, authorization: 'Bearer nonsense' }],
    ['empty bearer token', { ...PROXY_HEADERS, authorization: 'Bearer ' }],
    [
      'wrong cloud identifier for the configured issuer',
      { ...PROXY_HEADERS, 'x-mc-api-cloud-identifier': 'aws-us', authorization: ALG_NONE },
    ],
  ];

  for (const [label, headers] of rejectionMatrix) {
    it(`rejects with 401: ${label}`, async () => {
      const response = await request(app).get('/gateway/reports').set(headers);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHENTICATED');
    });
  }

  it('never leaks a stack trace or an upstream message', async () => {
    const response = await request(app)
      .get('/gateway/reports')
      .set({ ...PROXY_HEADERS, authorization: ALG_NONE });

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/at \w+ \(/); // no stack frames
    expect(body).not.toMatch(/node_modules/);
    expect(body).not.toMatch(/jwks|jose|signature/i);
    expect(response.body.message).toBe('The Merchant Center session could not be verified.');
  });

  it('returns a correlation id on every response, so a 401 is traceable', async () => {
    const response = await request(app)
      .get('/gateway/reports')
      .set({ ...PROXY_HEADERS, authorization: ALG_NONE });
    expect(response.body.correlationId).toBeTruthy();
    expect(response.headers['x-correlation-id']).toBeTruthy();
  });

  it('echoes a caller-supplied correlation id so traces join up across the fan-out', async () => {
    const response = await request(app)
      .get('/gateway/status')
      .set({ 'x-correlation-id': 'trace-me-123' });
    expect(response.headers['x-correlation-id']).toBe('trace-me-123');
  });

  it('does not advertise the server implementation', async () => {
    const response = await request(app).get('/gateway/status');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
