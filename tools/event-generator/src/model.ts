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

export interface OrderDraftInputs {
  orderNumber: string;
  completedAt: string; // ISO
  currency: string;
  country: string;
  channelKey?: string;
  storeKey?: string;
  lines: Array<{ variant: PoolVariant; quantity: number; unitPrice: number }>;
}

/** Builds one OrderImportDraft. Tax is split at a flat 19% so tax metrics are non-zero. */
export const toImportDraft = (input: OrderDraftInputs): Record<string, unknown> => {
  const gross = input.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const net = Math.round(gross / 1.19);

  return {
    orderNumber: input.orderNumber,
    orderState: 'Complete',
    completedAt: input.completedAt,
    country: input.country,
    ...(input.storeKey ? { store: { typeId: 'store', key: input.storeKey } } : {}),
    totalPrice: { currencyCode: input.currency, centAmount: gross },
    taxedPrice: {
      totalNet: { currencyCode: input.currency, centAmount: net },
      totalGross: { currencyCode: input.currency, centAmount: gross },
      totalTax: { currencyCode: input.currency, centAmount: gross - net },
    },
    lineItems: input.lines.map((l) => ({
      name: { en: l.variant.name },
      variant: { sku: l.variant.sku },
      price: { value: { currencyCode: input.currency, centAmount: l.unitPrice } },
      quantity: l.quantity,
      ...(input.channelKey
        ? { distributionChannel: { typeId: 'channel', key: input.channelKey } }
        : {}),
    })),
  };
};
