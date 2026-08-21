import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGa4Payload, isWithinMpWindow, readGa4Config } from './ga4.js';
import type { OrderDraftInputs } from './model.js';

const order = (completedAt: string): OrderDraftInputs => ({
  orderNumber: 'SIM-20260821-0001',
  completedAt,
  currency: 'EUR',
  country: 'DE',
  lines: [
    { variant: { sku: 'A', name: 'A', prices: { EUR: 1000 } }, quantity: 2, unitPrice: 1000 },
    { variant: { sku: 'B', name: 'B', prices: { EUR: 500 } }, quantity: 1, unitPrice: 500 },
  ],
});

test('builds a funnel of standard events (no reserved names), each carrying a session_id', () => {
  const payload = buildGa4Payload(order('2026-08-21T10:00:00.000Z'), 42);
  const names = payload.events.map((e) => e.name);
  // session_start is reserved in the Measurement Protocol and must NOT be sent.
  assert.ok(!names.includes('session_start'));
  assert.equal(names.filter((n) => n === 'view_item').length, 2);
  assert.ok(names.includes('begin_checkout'));
  assert.equal(names.filter((n) => n === 'purchase').length, 1);
  // Every event carries the session id so GA4 stitches them into one session.
  assert.ok(payload.events.every((e) => typeof e.params.session_id === 'string'));
});

test('purchase value equals the order total and carries the order number as transaction_id', () => {
  const payload = buildGa4Payload(order('2026-08-21T10:00:00.000Z'), 42);
  const purchase = payload.events.find((e) => e.name === 'purchase')!;
  // 2*1000 + 1*500 = 2500 minor => 25.00 major.
  assert.equal(purchase.params.value, 25);
  assert.equal(purchase.params.currency, 'EUR');
  assert.equal(purchase.params.transaction_id, 'SIM-20260821-0001');
});

test('is deterministic for the same order + seed', () => {
  const a = JSON.stringify(buildGa4Payload(order('2026-08-21T10:00:00.000Z'), 42));
  const b = JSON.stringify(buildGa4Payload(order('2026-08-21T10:00:00.000Z'), 42));
  assert.equal(a, b);
});

test('enforces the Measurement Protocol 72h window', () => {
  const now = Date.parse('2026-08-21T10:00:00.000Z');
  assert.equal(isWithinMpWindow(order('2026-08-21T09:00:00.000Z'), now), true); // 1h old
  assert.equal(isWithinMpWindow(order('2026-08-17T10:00:00.000Z'), now), false); // 4d old
});

test('sender is inert without credentials', () => {
  assert.equal(readGa4Config({}), null);
  assert.notEqual(readGa4Config({ GA4_MEASUREMENT_ID: 'G-X', GA4_API_SECRET: 's' }), null);
});
