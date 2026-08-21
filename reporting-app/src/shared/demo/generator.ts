import { addDays, eachDay, parseDay } from '../util/date-range';

/**
 * Deterministic demo data.
 *
 * This lives in `shared/` on purpose: every connector generates from the SAME seed and the
 * SAME entity lists, so a cross-source report shows coherent numbers instead of nonsense.
 * A conversion rate built from GA4 sessions and commercetools orders is only believable in a
 * demo if both sides agree on which days were busy.
 *
 * Everything is a pure function of (seed, date, entity) — no clock, no randomness, no state.
 * The same inputs always produce the same figures, which also makes it usable in tests.
 */

/** Mulberry32: small, fast, and deterministic given a 32-bit seed. */
const rng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Stable 32-bit hash so a string entity maps to a repeatable seed offset. */
const hash = (input: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

export const DEMO_SEED = 42;

export const DEMO_STORES = ['de-berlin-01', 'uk-manchester-01', 'fr-lyon-01'] as const;
export const DEMO_CHANNELS = ['web', 'mobile-app', 'retail'] as const;
export const DEMO_COUNTRIES = ['DE', 'GB', 'FR', 'NL', 'ES'] as const;
export const DEMO_CURRENCIES = ['EUR', 'GBP'] as const;
export const DEMO_CATEGORIES = [
  'outerwear',
  'footwear',
  'accessories',
  'knitwear',
  'denim',
  'bags',
] as const;
export const DEMO_DEVICES = ['desktop', 'mobile', 'tablet'] as const;
export const DEMO_TRAFFIC_CHANNELS = [
  'Organic Search',
  'Paid Search',
  'Direct',
  'Paid Social',
  'Email',
  'Referral',
] as const;

/** Currency follows the store's market, so money never mixes incoherently. */
export const currencyForStore = (store: string): string => (store.startsWith('uk-') ? 'GBP' : 'EUR');
export const countryForStore = (store: string): string =>
  store.startsWith('uk-') ? 'GB' : store.startsWith('fr-') ? 'FR' : 'DE';

export const skuFor = (category: string, index: number): string =>
  `${category.slice(0, 3).toUpperCase()}-${String(index).padStart(4, '0')}`;

export const DEMO_SKUS: string[] = DEMO_CATEGORIES.flatMap((category) =>
  Array.from({ length: 60 }, (_, index) => skuFor(category, index + 1))
);

/**
 * A seasonality multiplier with the shape real trading has: a weekend lift, a Black Friday
 * spike, a December peak and a January trough. Without this, every chart is a flat line and
 * the demo teaches nothing about the reports.
 */
export const seasonality = (day: string): number => {
  const date = new Date(parseDay(day));
  const dayOfWeek = date.getUTCDay();
  const month = date.getUTCMonth();
  const dayOfMonth = date.getUTCDate();

  // Saturday and Sunday trade harder online.
  const weekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1.28 : dayOfWeek === 5 ? 1.1 : 1;

  // Black Friday: the last Friday of November, plus the Cyber Monday tail.
  let event = 1;
  if (month === 10 && dayOfMonth >= 22 && dayOfMonth <= 30) {
    event = dayOfWeek === 5 ? 4.2 : dayOfWeek === 1 ? 2.6 : 1.7;
  }
  // Pre-Christmas peak, then the January discount trough.
  if (month === 11 && dayOfMonth <= 20) event = Math.max(event, 1.6);
  if (month === 0) event = Math.min(event, 0.72);
  // Northern-hemisphere summer lull.
  if (month === 6 || month === 7) event *= 0.88;

  return weekend * event;
};

export interface DemoOrderDay {
  date: string;
  store: string;
  channel: string;
  country: string;
  currency: string;
  orderState: string;
  orders: number;
  revenueGross: number;
  revenueNet: number;
  discount: number;
  shipping: number;
  tax: number;
  refunds: number;
  units: number;
  lines: number;
  customersNew: number;
  customersActive: number;
  ordersPromoted: number;
}

/**
 * Order facts for one day, split by store x channel.
 *
 * Money is in minor units throughout, and each store only ever reports its own currency,
 * so a report that sums across stores without grouping by currency is correctly refused
 * rather than quietly wrong.
 */
export const demoOrderDay = (day: string, seed = DEMO_SEED): DemoOrderDay[] => {
  const out: DemoOrderDay[] = [];
  const factor = seasonality(day);

  for (const store of DEMO_STORES) {
    for (const channel of DEMO_CHANNELS) {
      const random = rng(seed + hash(`${day}|${store}|${channel}`));

      // Retail is smaller online-adjacent volume; mobile app sits between.
      const scale = channel === 'web' ? 1 : channel === 'mobile-app' ? 0.62 : 0.28;
      const storeScale = store.startsWith('de-') ? 1 : store.startsWith('uk-') ? 0.78 : 0.55;

      const orders = Math.max(1, Math.round(120 * scale * storeScale * factor * (0.85 + random() * 0.3)));
      const aovMinor = Math.round(6200 + random() * 5200);
      const revenueGross = orders * aovMinor;
      // Discount depth rises during peak events, which is what makes the margin-erosion
      // report show something interesting.
      const discountRate = 0.06 + (factor > 1.5 ? 0.14 : 0.02) * random();
      const discount = Math.round(revenueGross * discountRate);
      const revenueNet = revenueGross - discount;
      const shipping = Math.round(orders * (channel === 'retail' ? 0 : 399));
      const tax = Math.round(revenueNet * 0.19);
      const refunds = Math.round(revenueNet * (0.02 + random() * 0.04));
      const units = Math.round(orders * (1.6 + random() * 1.1));
      const lines = Math.round(orders * (1.3 + random() * 0.7));
      const customersNew = Math.round(orders * (0.28 + random() * 0.2));
      const customersActive = Math.round(orders * (0.82 + random() * 0.12));
      const ordersPromoted = Math.round(orders * (factor > 1.5 ? 0.62 : 0.24));

      out.push({
        date: day,
        store,
        channel,
        country: countryForStore(store),
        currency: currencyForStore(store),
        orderState: 'Confirmed',
        orders,
        revenueGross,
        revenueNet,
        discount,
        shipping,
        tax,
        refunds,
        units,
        lines,
        customersNew,
        customersActive,
        ordersPromoted,
      });
    }
  }
  return out;
};

export interface DemoWebDay {
  date: string;
  country: string;
  device: string;
  trafficChannel: string;
  sessions: number;
  activeUsers: number;
  newUsers: number;
  pageviews: number;
  productViews: number;
  addToCarts: number;
  checkoutStarts: number;
  searches: number;
  zeroResultSearches: number;
}

/**
 * Web-analytics facts for one day.
 *
 * Derived from the SAME seasonality as the order data, so conversion rate lands in a
 * believable 1.5–3.5% band instead of wandering. Funnel step ratios follow the shape a real
 * store sees: sessions -> PDP -> add-to-cart -> checkout -> order.
 */
export const demoWebDay = (day: string, seed = DEMO_SEED): DemoWebDay[] => {
  const out: DemoWebDay[] = [];
  const factor = seasonality(day);

  for (const country of DEMO_COUNTRIES) {
    for (const device of DEMO_DEVICES) {
      for (const trafficChannel of DEMO_TRAFFIC_CHANNELS) {
        const random = rng(seed + hash(`${day}|${country}|${device}|${trafficChannel}`));

        const countryScale =
          country === 'DE' ? 1 : country === 'GB' ? 0.8 : country === 'FR' ? 0.55 : 0.22;
        const deviceScale = device === 'mobile' ? 1.15 : device === 'desktop' ? 0.85 : 0.2;
        const channelScale =
          trafficChannel === 'Organic Search'
            ? 1
            : trafficChannel === 'Paid Search'
              ? 0.7
              : trafficChannel === 'Direct'
                ? 0.55
                : trafficChannel === 'Paid Social'
                  ? 0.4
                  : trafficChannel === 'Email'
                    ? 0.3
                    : 0.15;

        const sessions = Math.max(
          1,
          Math.round(900 * countryScale * deviceScale * channelScale * factor * (0.85 + random() * 0.3))
        );
        const activeUsers = Math.round(sessions * (0.78 + random() * 0.1));
        const newUsers = Math.round(activeUsers * (0.42 + random() * 0.18));
        const pageviews = Math.round(sessions * (3.4 + random() * 2.1));
        const productViews = Math.round(sessions * (0.58 + random() * 0.22));
        const addToCarts = Math.round(productViews * (0.14 + random() * 0.07));
        const checkoutStarts = Math.round(addToCarts * (0.42 + random() * 0.14));
        const searches = Math.round(sessions * (0.22 + random() * 0.1));
        const zeroResultSearches = Math.round(searches * (0.05 + random() * 0.05));

        out.push({
          date: day,
          country,
          device,
          trafficChannel,
          sessions,
          activeUsers,
          newUsers,
          pageviews,
          productViews,
          addToCarts,
          checkoutStarts,
          searches,
          zeroResultSearches,
        });
      }
    }
  }
  return out;
};

export interface DemoItemDay {
  date: string;
  store: string;
  currency: string;
  product: string;
  category: string;
  units: number;
  revenueNet: number;
  returnsUnits: number;
  unitCost: number;
}

/**
 * Item-grain facts, restricted to the top SKUs per store per day.
 *
 * That restriction is not cosmetic: at full SKU grain this cube is the thing that pushes an
 * installation off the Custom Object tier, so the demo models the same top-N-plus-residual
 * shape the real rollup uses.
 */
export const demoItemDay = (day: string, topN = 40, seed = DEMO_SEED): DemoItemDay[] => {
  const out: DemoItemDay[] = [];
  const factor = seasonality(day);

  for (const store of DEMO_STORES) {
    const currency = currencyForStore(store);
    // Rotate which SKUs sell, so product performance is not identical every day.
    const offset = hash(`${day}|${store}`) % DEMO_SKUS.length;

    for (let i = 0; i < topN; i += 1) {
      const product = DEMO_SKUS[(offset + i * 7) % DEMO_SKUS.length];
      const category = DEMO_CATEGORIES[hash(product) % DEMO_CATEGORIES.length];
      const random = rng(seed + hash(`${day}|${store}|${product}`));

      // Rank decay: a few SKUs carry most of the volume, as in any real catalogue.
      const rankDecay = 1 / (1 + i * 0.18);
      const units = Math.max(1, Math.round(26 * rankDecay * factor * (0.7 + random() * 0.6)));
      const unitPrice = Math.round(3200 + random() * 9000);
      const revenueNet = units * unitPrice;
      const returnsUnits = Math.round(units * (0.04 + random() * 0.09));
      const unitCost = Math.round(unitPrice * (0.42 + random() * 0.16));

      out.push({
        date: day,
        store,
        currency,
        product,
        category,
        units,
        revenueNet,
        returnsUnits,
        unitCost,
      });
    }
  }
  return out;
};

/** Every day in a range, for seeding. */
export const demoRange = (from: string, to: string): string[] => eachDay({ from, to });

/** A range ending yesterday, so demo data never includes a partial current day. */
export const demoWindow = (today: string, months = 18): { from: string; to: string } => ({
  from: addDays(today, -Math.round(months * 30.44)),
  to: today,
});
