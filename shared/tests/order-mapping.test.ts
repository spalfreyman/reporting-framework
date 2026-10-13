import { describe, expect, it } from 'vitest';
import {
  applyLineCategories,
  businessDateOf,
  foldCohort,
  foldFulfilmentDaily,
  foldOrderCategoriesDaily,
  foldOrderLinesDaily,
  foldOrdersDaily,
  foldPromotionsDaily,
  toOrderFact,
} from '../src/rollup/order-mapping.js';
import type { OrderProjection } from '../src/rollup/order-mapping.js';
import type { OrderFact } from '../src/rollup/keying.js';

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

describe('cost of goods (line price cost custom field)', () => {
  const withCost = (unitCost: number): OrderProjection => ({
    ...base,
    lineItems: [
      {
        quantity: 2,
        variant: { sku: 'SKU-1' },
        totalPrice: { centAmount: 10000 },
        category: 'c1',
        price: {
          value: { centAmount: 5000 },
          custom: { customFieldsRaw: [{ name: 'cost', value: { type: 'centPrecision', currencyCode: 'EUR', centAmount: unitCost } }] },
        },
      },
    ],
  });

  it('captures per-line cost = unit cost x quantity from the price cost custom field', () => {
    const fact = toOrderFact(withCost(3000), 'UTC');
    expect(fact.items?.[0].cost).toBe(6000); // 3000 x 2
  });

  it('defaults cost to 0 when the line carries no cost custom field', () => {
    expect(toOrderFact(base, 'UTC').items?.[0].cost).toBe(0);
  });

  it('folds cost into the order-lines-daily and order-categories-daily cubes', () => {
    const fact = toOrderFact(withCost(3000), 'UTC');
    expect(foldOrderLinesDaily([fact])[0].m.cost).toBe(6000);
    expect(foldOrderCategoriesDaily([fact])[0].m.cost).toBe(6000);
  });
});

describe('promotions (order custom promoCode)', () => {
  const promoted = (): OrderProjection => ({
    ...base,
    completedAt: '2026-09-10T10:00:00.000Z',
    discountOnTotalPrice: { discountedAmount: { centAmount: 1500 } },
    custom: { customFieldsRaw: [{ name: 'promoCode', value: 'WELCOME10' }] },
  });

  it('carries the promo code as a dimension and marks the order promoted with a redemption', () => {
    const fact = toOrderFact(promoted(), 'UTC');
    expect(fact.dims.discountCode).toBe('WELCOME10');
    expect(fact.measures.redemptions).toBe(1);
    expect(fact.measures.ordersPromoted).toBe(1);
    expect(fact.measures.discount).toBe(1500);
  });

  it('folds redemptions into promotions-daily keyed by discount code, skipping un-promoted orders', () => {
    const cells = foldPromotionsDaily([toOrderFact(promoted(), 'UTC'), toOrderFact(base, 'UTC')]);
    expect(cells).toHaveLength(1);
    expect(cells[0].k.discountCode).toBe('WELCOME10');
    expect(cells[0].m.redemptions).toBe(1);
  });
});

describe('fulfilment (order custom dispatch fields)', () => {
  const shipped = (shippedAt: string): OrderProjection => ({
    ...base,
    completedAt: '2026-09-10T10:00:00.000Z',
    custom: {
      customFieldsRaw: [
        { name: 'shippedAt', value: shippedAt },
        { name: 'carrier', value: 'DHL' },
        { name: 'shippingMethod', value: 'Express' },
      ],
    },
  });

  it('counts a shipment and marks on-time within the 2-day SLA', () => {
    const fact = toOrderFact(shipped('2026-09-11T08:00:00.000Z'), 'UTC'); // +1 day
    expect(fact.measures.shipments).toBe(1);
    expect(fact.measures.shipmentsOnTime).toBe(1);
    expect(fact.dims.shippingMethod).toBe('Express');
  });

  it('counts a late shipment but not on-time beyond the SLA', () => {
    const fact = toOrderFact(shipped('2026-09-15T08:00:00.000Z'), 'UTC'); // +5 days
    expect(fact.measures.shipments).toBe(1);
    expect(fact.measures.shipmentsOnTime).toBe(0);
  });

  it('folds shipments into fulfilment-daily by shipping method, skipping un-shipped orders', () => {
    const cells = foldFulfilmentDaily([
      toOrderFact(shipped('2026-09-11T08:00:00.000Z'), 'UTC'),
      toOrderFact(base, 'UTC'),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0].k.shippingMethod).toBe('Express');
    expect(cells[0].k.carrier).toBe('DHL');
    expect(cells[0].m.shipments).toBe(1);
    expect(cells[0].m.shipmentsOnTime).toBe(1);
  });
});

describe('customer key (cohort grouping identity)', () => {
  it('hashes the customer identity onto the fact rather than storing raw PII', () => {
    const withEmail = toOrderFact({ ...base, customerEmail: 'a@demo.example' }, 'UTC');
    expect(withEmail.customerKey).toBeTruthy();
    expect(withEmail.customerKey).not.toBe('a@demo.example'); // hashed, not the raw email
  });

  it('is stable for the same customer and differs across customers', () => {
    const a1 = toOrderFact({ ...base, id: 'a1', customerEmail: 'a@demo.example' }, 'UTC');
    const a2 = toOrderFact({ ...base, id: 'a2', customerEmail: 'a@demo.example' }, 'UTC');
    const b = toOrderFact({ ...base, id: 'b', customerEmail: 'b@demo.example' }, 'UTC');
    expect(a1.customerKey).toBe(a2.customerKey);
    expect(a1.customerKey).not.toBe(b.customerKey);
  });

  it('is empty for a guest order (no id, no email)', () => {
    expect(toOrderFact(base, 'UTC').customerKey).toBe('');
  });
});

describe('foldCohort (retention matrix)', () => {
  const fact = (customerKey: string, businessDate: string, store = '_none'): OrderFact =>
    ({ customerKey, businessDate, dims: { store }, measures: {} }) as unknown as OrderFact;

  it('assigns each customer to their first-order month and counts distinct retention per period', () => {
    // A: active 2026-01 (first), 02, 03.  B: active 2026-01 (first), 03.  latest = 2026-03.
    const cells = foldCohort([
      fact('A', '2026-01-10'),
      fact('A', '2026-02-05'),
      fact('A', '2026-03-20'),
      fact('B', '2026-01-15'),
      fact('B', '2026-03-02'),
    ]);
    const byPeriod = Object.fromEntries(
      cells
        .filter((c) => c.k.cohortMonth === '2026-01')
        .map((c) => [c.k.periodIndex, c.m])
    );
    expect(byPeriod['0']).toEqual({ cohortSize: 2, retained: 2 }); // both in cohort month
    expect(byPeriod['1']).toEqual({ cohortSize: 2, retained: 1 }); // only A returned in Feb
    expect(byPeriod['2']).toEqual({ cohortSize: 2, retained: 2 }); // both active in Mar
  });

  it('emits no cell for periods that have not elapsed yet (so retention.rate is blank, not 0)', () => {
    // Single customer, first (and only) month 2026-03 which is also the latest → only period 0.
    const cells = foldCohort([fact('A', '2026-03-10')]);
    expect(cells.map((c) => c.k.periodIndex)).toEqual(['0']);
    expect(cells[0].m).toEqual({ cohortSize: 1, retained: 1 });
  });

  it('ignores guest orders (no customer key)', () => {
    expect(foldCohort([fact('', '2026-01-01')])).toEqual([]);
  });
});

describe('order state and refunds', () => {
  it('carries paymentState as a fact dimension, defaulting to _none', () => {
    expect(toOrderFact(base, 'UTC').dims.paymentState).toBe('_none');
    expect(toOrderFact({ ...base, paymentState: 'Paid' }, 'UTC').dims.paymentState).toBe('Paid');
  });

  it('treats a CreditOwed order as fully refunded, without unbooking the sale', () => {
    // net = gross/1.19 of 10000 = 8403. The sale still books; the refund lands in refunds.
    const fact = toOrderFact({ ...base, paymentState: 'CreditOwed' }, 'UTC');
    expect(fact.measures.refunds).toBe(fact.measures.revenueNet);
    expect(fact.measures.revenueNet).toBeGreaterThan(0);
  });

  it('a Paid order has zero refunds', () => {
    expect(toOrderFact({ ...base, paymentState: 'Paid' }, 'UTC').measures.refunds).toBe(0);
  });

  it('folds orders of the same currency but different payment state into separate cells', () => {
    const cells = foldOrdersDaily([
      toOrderFact({ ...base, id: 'a', paymentState: 'Paid' }, 'UTC'),
      toOrderFact({ ...base, id: 'b', paymentState: 'CreditOwed' }, 'UTC'),
    ]);
    expect(cells.map((c) => c.k.paymentState).sort()).toEqual(['CreditOwed', 'Paid']);
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
