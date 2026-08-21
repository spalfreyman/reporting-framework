import { describe, expect, it } from 'vitest';
import { businessDateOf, toOrderFact, foldOrdersDaily } from '../src/rollup/order-mapping.js';
import type { OrderProjection } from '../src/rollup/order-mapping.js';

/**
 * The order -> fact mapping is the one place an order's worth is decided, shared by the
 * event handler and the job. Its date choice and money handling are what the trading
 * reports rest on.
 */

const base: OrderProjection = {
  id: 'o1',
  version: 1,
  createdAt: '2026-08-21T09:00:00.000Z',
  lastModifiedAt: '2026-08-21T09:00:00.000Z',
  orderState: 'Complete',
  country: 'DE',
  totalPrice: { currencyCode: 'EUR', centAmount: 10000, fractionDigits: 2 },
  lineItems: [{ quantity: 2, variant: { sku: 'SKU-1' }, totalPrice: { centAmount: 10000 } }],
};

describe('businessDate', () => {
  it('prefers completedAt when set, so an imported order carries its real date', () => {
    // createdAt is server-assigned to "now"; completedAt is the settable historical date.
    const order = { ...base, completedAt: '2026-05-04T12:00:00.000Z' };
    expect(businessDateOf(order, 'UTC')).toBe('2026-05-04');
  });

  it('falls back to createdAt when completedAt is absent, leaving live orders unaffected', () => {
    expect(businessDateOf(base, 'UTC')).toBe('2026-08-21');
  });

  it('buckets the fact on the completedAt day', () => {
    const fact = toOrderFact({ ...base, completedAt: '2026-05-04T12:00:00.000Z' }, 'UTC');
    expect(fact.businessDate).toBe('2026-05-04');
  });
});

describe('fold keeps currencies separate', () => {
  it('never merges rows of different currencies', () => {
    const facts = [
      toOrderFact({ ...base, id: 'a', totalPrice: { currencyCode: 'EUR', centAmount: 10000, fractionDigits: 2 } }, 'UTC'),
      toOrderFact({ ...base, id: 'b', totalPrice: { currencyCode: 'GBP', centAmount: 5000, fractionDigits: 2 } }, 'UTC'),
    ];
    const cells = foldOrdersDaily(facts);
    expect(cells.map((c) => c.k.currency).sort()).toEqual(['EUR', 'GBP']);
  });
});
