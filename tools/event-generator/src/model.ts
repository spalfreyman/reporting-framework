/**
 * The shape of a simulated order and the realistic distributions behind it.
 *
 * Kept deterministic given a seed so a run is reproducible, and so — later — the GA4
 * Measurement Protocol events can be generated from the same seed and reconcile with the
 * orders. No randomness that isn't seeded.
 */

export const MARK_PREFIX = 'SIM-';

/** Mulberry32 — small deterministic PRNG. */
export const rng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const hash = (input: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/**
 * A trading-shaped seasonality multiplier: weekend lift, a Black Friday spike, a December
 * peak and a January trough. Gives the trend charts genuine shape rather than a flat line.
 * (Mirrors the framework's own demo generator so the two tell the same story.)
 */
export const seasonality = (isoDate: string): number => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const dow = date.getUTCDay();
  const month = date.getUTCMonth();
  const dom = date.getUTCDate();

  const weekend = dow === 0 || dow === 6 ? 1.28 : dow === 5 ? 1.1 : 1;
  let event = 1;
  if (month === 10 && dom >= 22 && dom <= 30) event = dow === 5 ? 4.2 : dow === 1 ? 2.6 : 1.7;
  if (month === 11 && dom <= 20) event = Math.max(event, 1.6);
  if (month === 0) event = Math.min(event, 0.72);
  if (month === 6 || month === 7) event *= 0.88;
  return weekend * event;
};

/** Currency → the markets and sales channels that go with it, so breakdowns read sensibly. */
export interface Region {
  currency: string;
  weight: number;
  countries: string[];
  /** Preferred distribution-channel keys, filtered against what the project actually has. */
  channels: string[];
  /** Preferred store keys, filtered against what the project actually has. */
  stores: string[];
}

export const REGIONS: Region[] = [
  { currency: 'EUR', weight: 0.5, countries: ['DE', 'FR', 'NL', 'IT'], channels: ['amsterdam', 'hamburg', 'munich'], stores: ['germany', 'France_HDS', 'demo1'] },
  { currency: 'GBP', weight: 0.3, countries: ['GB'], channels: ['london'], stores: ['london', 'Outlet'] },
  { currency: 'USD', weight: 0.2, countries: ['US', 'CA'], channels: ['sanfrancisco'], stores: ['demo1'] },
];

export const pick = <T>(items: T[], r: number): T => items[Math.floor(r * items.length) % items.length];

export const weightedRegion = (r: number): Region => {
  const total = REGIONS.reduce((s, x) => s + x.weight, 0);
  let acc = r * total;
  for (const region of REGIONS) {
    acc -= region.weight;
    if (acc <= 0) return region;
  }
  return REGIONS[0];
};

export interface PoolVariant {
  sku: string;
  name: string;
  /** centAmount by currency. */
  prices: Record<string, number>;
}

/**
 * The lifecycle a simulated order is in. Mapped to real commercetools order/payment states by
 * BUSINESS_STATES so the state breakdowns in the reports are populated, and so `refunded`
 * orders carry the CreditOwed payment state the rollup reads as a refund.
 *
 *   ordered   → Open      / Paid        (placed, being fulfilled)
 *   completed → Complete  / Paid        (fulfilled)
 *   canceled  → Cancelled / Failed
 *   refunded  → Complete  / CreditOwed  (refund lands in refunds.value@cashdate)
 *   abandoned → Open      / Pending     (started, never paid — browse-only in GA4)
 */
export type BusinessState = 'ordered' | 'completed' | 'canceled' | 'refunded' | 'abandoned';

export interface StateMapping {
  orderState: 'Open' | 'Confirmed' | 'Complete' | 'Cancelled';
  paymentState: 'Paid' | 'Pending' | 'CreditOwed' | 'Failed' | 'BalanceDue';
  /** Did a checkout complete? Drives whether GA4 gets a purchase or a browse-only session. */
  converts: boolean;
  /** Relative frequency in the generated mix. */
  weight: number;
}

export const BUSINESS_STATES: Record<BusinessState, StateMapping> = {
  completed: { orderState: 'Complete', paymentState: 'Paid', converts: true, weight: 0.5 },
  ordered: { orderState: 'Open', paymentState: 'Paid', converts: true, weight: 0.18 },
  abandoned: { orderState: 'Open', paymentState: 'Pending', converts: false, weight: 0.14 },
  canceled: { orderState: 'Cancelled', paymentState: 'Failed', converts: true, weight: 0.1 },
  refunded: { orderState: 'Complete', paymentState: 'CreditOwed', converts: true, weight: 0.08 },
};

export const pickBusinessState = (r: number): BusinessState => {
  const entries = Object.entries(BUSINESS_STATES) as Array<[BusinessState, StateMapping]>;
  const total = entries.reduce((s, [, m]) => s + m.weight, 0);
  let acc = r * total;
  for (const [state, mapping] of entries) {
    acc -= mapping.weight;
    if (acc <= 0) return state;
  }
  return 'completed';
};

export interface OrderDraftInputs {
  orderNumber: string;
  completedAt: string; // ISO
  currency: string;
  country: string;
  channelKey?: string;
  storeKey?: string;
  businessState: BusinessState;
  lines: Array<{ variant: PoolVariant; quantity: number; unitPrice: number }>;
  /** Stable synthetic customer so repeat buyers form cohorts (new-vs-returning, retention). */
  customerEmail: string;
  /** Applied promotion, when this order was discounted. Drives penetration + discount metrics. */
  promo?: { code: string; amount: number };
  /** Dispatch info for fulfilled orders — synthetic ship date + carrier for the SLA report. */
  fulfilment?: { shippedAt: string; carrier: string; shippingMethod: string };
}

/** A small pool of discount codes + the cart discount each maps to, created once by the generator. */
export const PROMO_CODES = ['WELCOME10', 'VIP15', 'FLASH20'] as const;
export const PROMO_RATE: Record<(typeof PROMO_CODES)[number], number> = {
  WELCOME10: 0.1,
  VIP15: 0.15,
  FLASH20: 0.2,
};
export const CARRIERS = ['DHL', 'UPS', 'Royal Mail', 'DPD'] as const;
export const SHIPPING_METHODS = ['Standard', 'Express', 'NextDay'] as const;
/** Order custom Type carrying synthetic reporting metadata: dispatch (ship date/carrier/method)
 *  and the applied promo code. One type keeps the Order Import draft simple and ref-free. */
export const ORDER_META_TYPE_KEY = 'reporting-order-meta';
/** Size of the recurring customer pool — small enough that buyers repeat across months. */
export const CUSTOMER_POOL = 60;

/** Builds one OrderImportDraft. Tax is split at a flat 19% so tax metrics are non-zero. */
/** Key of the custom Type that carries the per-unit `cost` (a Money) on a price. */
export const COST_TYPE_KEY = 'reporting-price-cost';

/**
 * Deterministic per-unit cost of goods for a SKU: 55-70% of the unit price, varied per SKU so
 * gross margins land in a believable ~30-45% spread. Captured on each order line's price at
 * import, which is where cost.goods@orderdate reads it from.
 */
export const costUnitAmount = (sku: string, unitPrice: number): number => {
  const factor = 0.55 + (hash(sku) % 16) / 100; // 0.55 .. 0.70
  return Math.round(unitPrice * factor);
};

export const toImportDraft = (input: OrderDraftInputs): Record<string, unknown> => {
  const lineGross = input.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  // totalPrice is the amount actually charged — i.e. AFTER the order discount, so a promoted
  // order realistically books less revenue. The discount is NOT recorded as `discountOnTotalPrice`:
  // the Order Import API requires that object to carry `includedDiscounts` referencing a real
  // CartDiscount, which a synthetic import has none of (it 400s with InvalidJsonInput otherwise).
  // The applied promo is instead carried as the `promoCode` order custom field, which is what the
  // promotion report reads for penetration + redemptions.
  const discountAmount = input.promo?.amount ?? 0;
  const gross = Math.max(0, lineGross - discountAmount);
  const net = Math.round(gross / 1.19);
  const mapping = BUSINESS_STATES[input.businessState];

  // One order custom type carries synthetic reporting metadata: the applied promo code and the
  // dispatch fields. Built ref-free (plain string/datetime values) so the Order Import never 400s.
  const metaFields: Record<string, unknown> = {};
  if (input.promo) metaFields.promoCode = input.promo.code;
  if (input.fulfilment) {
    metaFields.shippedAt = input.fulfilment.shippedAt;
    metaFields.carrier = input.fulfilment.carrier;
    metaFields.shippingMethod = input.fulfilment.shippingMethod;
  }

  return {
    orderNumber: input.orderNumber,
    orderState: mapping.orderState,
    paymentState: mapping.paymentState,
    completedAt: input.completedAt,
    country: input.country,
    customerEmail: input.customerEmail,
    ...(input.storeKey ? { store: { typeId: 'store', key: input.storeKey } } : {}),
    totalPrice: { currencyCode: input.currency, centAmount: gross },
    taxedPrice: {
      totalNet: { currencyCode: input.currency, centAmount: net },
      totalGross: { currencyCode: input.currency, centAmount: gross },
      totalTax: { currencyCode: input.currency, centAmount: gross - net },
    },
    ...(Object.keys(metaFields).length > 0
      ? { custom: { type: { typeId: 'type', key: ORDER_META_TYPE_KEY }, fields: metaFields } }
      : {}),
    lineItems: input.lines.map((l) => ({
      name: { en: l.variant.name },
      variant: { sku: l.variant.sku },
      price: {
        value: { currencyCode: input.currency, centAmount: l.unitPrice },
        // Stamp the per-unit cost on the line's price so the order captures cost at order time;
        // the rollup reads price.custom.cost to produce cost.goods@orderdate and margin.
        custom: {
          type: { typeId: 'type', key: COST_TYPE_KEY },
          fields: {
            cost: { currencyCode: input.currency, centAmount: costUnitAmount(l.variant.sku, l.unitPrice) },
          },
        },
      },
      quantity: l.quantity,
      ...(input.channelKey
        ? { distributionChannel: { typeId: 'channel', key: input.channelKey } }
        : {}),
    })),
  };
};
