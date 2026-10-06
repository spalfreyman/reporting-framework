import { describe, expect, it } from 'vitest';
import {
  applyLineCategories,
  businessDateOf,
  foldOrderCategoriesDaily,
  foldOrdersDaily,
  toOrderFact,
} from '../src/rollup/order-mapping.js';
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

describe('item-grain category rollup', () => {
  const catBase: OrderProjection = {
    ...base,
    lineItems: [
      { quantity: 2, productId: 'p-boots', variant: { sku: 'SKU-BOOTS' }, totalPrice: { centAmount: 6000 } },
      { quantity: 1, productId: 'p-coat', variant: { sku: 'SKU-COAT' }, totalPrice: { centAmount: 9000 } },
    ],
  };
  const resolve = (productId?: string | null) =>
    productId === 'p-boots' ? 'footwear' : productId === 'p-coat' ? 'outerwear' : '_none';

  it('applyLineCategories tags each line, which toOrderFact carries onto the item', () => {
    const order = structuredClone(catBase);
    applyLineCategories(order, resolve);
    const fact = toOrderFact(order, 'UTC');
    expect(fact.items?.map((i) => i.category).sort()).toEqual(['footwear', 'outerwear']);
  });

  it('folds net revenue and units per category, keeping every category (no top-N)', () => {
    const a = structuredClone(catBase);
    applyLineCategories(a, resolve);
    const b = structuredClone({ ...catBase, id: 'o2' });
    applyLineCategories(b, resolve);
    const cells = foldOrderCategoriesDaily([toOrderFact(a, 'UTC'), toOrderFact(b, 'UTC')]);
    const byCat = Object.fromEntries(cells.map((c) => [c.k.category, c.m]));
    expect(byCat.footwear.revenueNet).toBe(12000); // 6000 x 2 orders
    expect(byCat.footwear.units).toBe(4); // 2 units x 2 orders
    expect(byCat.outerwear.revenueNet).toBe(18000);
    expect(Object.keys(byCat).sort()).toEqual(['footwear', 'outerwear']);
  });
});
