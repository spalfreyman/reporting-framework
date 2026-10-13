import { loadEnv } from './load-env.js';
loadEnv();

import { CtClient, readConfig } from './ct.js';
import { Ga4Sender, readGa4Config, buildBrowsePayload } from './ga4.js';
import {
  BUSINESS_STATES,
  CARRIERS,
  COST_TYPE_KEY,
  CUSTOMER_POOL,
  MARK_PREFIX,
  ORDER_META_TYPE_KEY,
  PROMO_CODES,
  PROMO_RATE,
  REGIONS,
  SHIPPING_METHODS,
  hash,
  pick,
  pickBusinessState,
  rng,
  seasonality,
  toImportDraft,
  weightedRegion,
  type OrderDraftInputs,
  type PoolVariant,
} from './model.js';

/**
 * Test-order generator for the reporting demo.
 *
 * Creates REAL orders in the commercetools project via the Order Import API — genuine cart
 * activity for the reports to render — but marks every one with a `SIM-` order number so the
 * whole set is identifiable and removable (`cleanup`).
 *
 * Historical shape is real too: `completedAt` is settable on import (createdAt is not), and
 * the rollup buckets on it, so a 90-day seasonality curve produces dated orders rather than
 * a single spike on today.
 *
 *   npm run seed              # backfill DAYS days of shaped orders
 *   npm run loop              # then trickle new orders every LOOP_INTERVAL_MS
 *   npm run cleanup           # delete every SIM- order
 */

const env = process.env;
const num = (key: string, fallback: number): number => (env[key] ? Number(env[key]) : fallback);

const DAYS = num('GEN_DAYS', 90);
const ORDERS_PER_DAY = num('GEN_ORDERS_PER_DAY', 4);
const SEED = num('GEN_SEED', 42);
const CONCURRENCY = num('GEN_CONCURRENCY', 6);
const LOOP_INTERVAL_MS = num('GEN_LOOP_INTERVAL_MS', 60_000);
const LOOP_ORDERS = num('GEN_LOOP_ORDERS', 3);
/** 0 = run forever; >0 = stop cleanly after this many ticks (for a bounded background run). */
const LOOP_MAX_TICKS = num('GEN_LOOP_MAX_TICKS', 0);
/** `traffic` mode: how many non-converting browse sessions to send, and over what recent window. */
const SESSIONS = num('GEN_SESSIONS', 16000);
const SESSION_SPREAD_HOURS = num('GEN_SESSION_SPREAD_HOURS', 60);

const log = (message: string, extra: Record<string, unknown> = {}): void => {
  process.stdout.write(`${JSON.stringify({ message, ...extra, at: new Date().toISOString() })}\n`);
};

const isoDay = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

const runPool = async <T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> => {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
};

// ── Build the product / channel / store pool from what the project actually has ──────

interface Pool {
  variants: PoolVariant[];
  byCurrency: Record<string, PoolVariant[]>;
  channelKeys: Set<string>;
  /** key -> the countries the store permits (empty = unrestricted). */
  stores: Map<string, string[]>;
}

const buildPool = async (client: CtClient): Promise<Pool> => {
  type PP = {
    results: Array<{
      masterVariant: Variant;
      variants: Variant[];
    }>;
  };
  type Variant = { sku?: string; prices?: Array<{ value: { currencyCode: string; centAmount: number } }> };

  const variants: PoolVariant[] = [];
  const page = await client.get<PP>('/product-projections?staged=false&limit=200');
  for (const product of page.results) {
    for (const v of [product.masterVariant, ...(product.variants ?? [])]) {
      if (!v.sku || !v.prices?.length) continue;
      const prices: Record<string, number> = {};
      for (const p of v.prices) {
        // Keep the first price seen per currency.
        if (prices[p.value.currencyCode] === undefined) prices[p.value.currencyCode] = p.value.centAmount;
      }
      variants.push({ sku: v.sku, name: v.sku, prices });
    }
  }

  const byCurrency: Record<string, PoolVariant[]> = {};
  for (const region of REGIONS) {
    byCurrency[region.currency] = variants.filter((v) => v.prices[region.currency] !== undefined);
  }

  const channels = await client.get<{ results: Array<{ key?: string; roles: string[] }> }>('/channels?limit=200');
  const channelKeys = new Set(
    channels.results.filter((c) => c.key && c.roles.includes('ProductDistribution')).map((c) => c.key as string)
  );
  // Store.countries is an array of { code } objects, not strings — extract the codes.
  const stores = await client.get<{ results: Array<{ key?: string; countries?: Array<{ code: string }> }> }>(
    '/stores?limit=200'
  );
  const storeMap = new Map<string, string[]>();
  for (const s of stores.results) {
    if (s.key) storeMap.set(s.key, (s.countries ?? []).map((c) => c.code));
  }

  return { variants, byCurrency, channelKeys, stores: storeMap };
};

// ── Draft one order ──────────────────────────────────────────────────────────────────

const draftOrder = (pool: Pool, completedAt: string, seq: number): OrderDraftInputs | null => {
  const r = rng(SEED + hash(`${completedAt}:${seq}`));
  const region = weightedRegion(r());
  const catalogue = pool.byCurrency[region.currency];
  if (!catalogue || catalogue.length === 0) return null;

  // Vary basket size: most orders are small, but ~12% are large multi-line baskets, so the
  // order-value distribution has a realistic tail rather than everything clustering small.
  const large = r() < 0.12;
  const lineCount = large ? 5 + Math.floor(r() * 5) : 1 + Math.floor(r() * 4);
  const maxQty = large ? 6 : 3;
  const lines = Array.from({ length: lineCount }, () => {
    const variant = pick(catalogue, r());
    return { variant, quantity: 1 + Math.floor(r() * maxQty), unitPrice: variant.prices[region.currency] };
  }).filter((l) => l.unitPrice > 0);
  if (lines.length === 0) return null;

  const businessState = pickBusinessState(r());
  const mapping = BUSINESS_STATES[businessState];

  // A store restricts BOTH the channels and the countries it permits, and those
  // restrictions are project-specific. Rather than guess, set EITHER a store OR a
  // line-item channel per order (never a conflicting pair), and when using a store pick a
  // country the store actually permits. Both the store and channel breakdowns still fill
  // across the order set, and no import 400s on an incompatible reference.
  const availableChannel = region.channels.find((c) => pool.channelKeys.has(c));
  const availableStore = region.stores.find((s) => pool.stores.has(s));
  const useStore = r() < 0.5 && availableStore !== undefined;

  const channelKey = !useStore ? availableChannel : undefined;
  const storeKey = useStore ? availableStore : undefined;

  let country: string;
  if (storeKey) {
    const allowed = pool.stores.get(storeKey) ?? [];
    const compatible = allowed.filter((c) => region.countries.includes(c));
    country = compatible.length > 0 ? pick(compatible, r()) : allowed.length > 0 ? pick(allowed, r()) : pick(region.countries, r());
  } else {
    country = pick(region.countries, r());
  }

  const completedAtIso = `${completedAt}T${String(8 + Math.floor(r() * 11)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00.000Z`;

  // Recurring synthetic customer, so repeat buyers form cohorts / retention later.
  const customerEmail = `sim-cust-${Math.floor(r() * CUSTOMER_POOL)}@demo.example`;

  // ~25% of orders carry a promo code + matching order-level discount.
  const lineGross = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const promo = r() < 0.25
    ? (() => {
        const code = pick(PROMO_CODES as unknown as string[], r()) as keyof typeof PROMO_RATE;
        return { code, amount: Math.round(lineGross * PROMO_RATE[code]) };
      })()
    : undefined;

  // Fulfilled orders (Complete) get a synthetic dispatch: shipped 0-4 days after the order,
  // on-time when within the 2-day SLA (computed in the rollup). Carrier + method for the SLA report.
  const fulfilment = mapping.orderState === 'Complete'
    ? {
        shippedAt: new Date(Date.parse(completedAtIso) + Math.floor(r() * 5) * 86_400_000).toISOString(),
        carrier: pick(CARRIERS as unknown as string[], r()),
        shippingMethod: pick(SHIPPING_METHODS as unknown as string[], r()),
      }
    : undefined;

  return {
    orderNumber: `${MARK_PREFIX}${completedAt.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`,
    completedAt: completedAtIso,
    currency: region.currency,
    country,
    businessState,
    customerEmail,
    ...(promo ? { promo } : {}),
    ...(fulfilment ? { fulfilment } : {}),
    ...(channelKey ? { channelKey } : {}),
    ...(storeKey ? { storeKey } : {}),
    lines,
  };
};

/**
 * Sends the GA4 side for one order, honouring its business state: a converting order gets the
 * full view→cart→checkout→purchase funnel; an abandoned one gets a browse-only session (no
 * purchase), so the funnel shows genuine abandonment and the conversion rate stays believable.
 */
const sendGa4For = async (draft: OrderDraftInputs): Promise<void> => {
  if (!ga4) return;
  if (BUSINESS_STATES[draft.businessState].converts) {
    await ga4.send(draft, SEED);
    return;
  }
  const items = draft.lines.map((l) => ({
    item_id: l.variant.sku,
    item_name: l.variant.name,
    price: l.unitPrice / 100,
  }));
  await ga4.sendRaw(buildBrowsePayload(items, draft.currency, SEED + hash(draft.orderNumber), Date.parse(draft.completedAt)));
};

const importOrder = async (client: CtClient, draft: OrderDraftInputs): Promise<'created' | 'exists' | 'failed'> => {
  try {
    await client.post('/orders/import', toImportDraft(draft));
    return 'created';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A duplicate order number means this exact order was already generated — idempotent.
    if (/DuplicateField|already exists|orderNumber/i.test(message)) return 'exists';
    log('import failed', { orderNumber: draft.orderNumber, error: message });
    return 'failed';
  }
};

// ── Modes ──────────────────────────────────────────────────────────────────────────

const seed = async (client: CtClient): Promise<void> => {
  log('building product/channel/store pool from the project');
  const pool = await buildPool(client);
  log('pool ready', {
    variants: pool.variants.length,
    perCurrency: Object.fromEntries(Object.entries(pool.byCurrency).map(([c, v]) => [c, v.length])),
    channels: pool.channelKeys.size,
    stores: pool.stores.size,
  });

  const drafts: OrderDraftInputs[] = [];
  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    const day = isoDay(offset);
    const count = Math.max(1, Math.round(ORDERS_PER_DAY * seasonality(day) * (0.85 + rng(SEED + hash(day))() * 0.3)));
    for (let seq = 0; seq < count; seq += 1) {
      const draft = draftOrder(pool, day, seq);
      if (draft) drafts.push(draft);
    }
  }

  log('importing orders', { count: drafts.length, days: DAYS });
  let created = 0;
  let exists = 0;
  let failed = 0;
  await runPool(drafts, CONCURRENCY, async (draft, index) => {
    const outcome = await importOrder(client, draft);
    if (outcome === 'created') created += 1;
    else if (outcome === 'exists') exists += 1;
    else failed += 1;
    // GA4 only accepts events < 72h old, so historical seed days cannot reach it; the
    // sender counts what it skips rather than pretending it sent them.
    if (outcome !== 'failed') await sendGa4For(draft);
    if ((index + 1) % 50 === 0) log('progress', { done: index + 1, of: drafts.length });
  });

  log('seed complete', { created, alreadyExisted: exists, failed });
  if (ga4) {
    log('GA4 events', { sent: ga4.sent, skippedTooOldFor72hWindow: ga4.skippedTooOld, failed: ga4.failed });
  }
  log('next: run the rollup job to fold these into the reports', {
    cmd: 'cd ../../reporting-rollup-job && npm run build && node dist/src/index.js',
  });
};

const loop = async (client: CtClient): Promise<void> => {
  const pool = await buildPool(client);
  log('live loop started', { everyMs: LOOP_INTERVAL_MS, ordersPerTick: LOOP_ORDERS });
  let tick = 0;
  for (;;) {
    const today = isoDay(0);
    for (let i = 0; i < LOOP_ORDERS; i += 1) {
      const draft = draftOrder(pool, today, Date.now() + i);
      if (draft) {
        // A live order's completion is now, not a historical day.
        draft.completedAt = new Date().toISOString();
        const outcome = await importOrder(client, draft);
        if (outcome !== 'failed') await sendGa4For(draft);
      }
    }
    tick += 1;
    log('live tick', {
      tick,
      added: LOOP_ORDERS,
      ...(ga4 ? { ga4Sent: ga4.sent, ga4Failed: ga4.failed } : {}),
    });
    if (LOOP_MAX_TICKS > 0 && tick >= LOOP_MAX_TICKS) {
      log('live loop finished', {
        ticks: tick,
        ordersCreated: tick * LOOP_ORDERS,
        ...(ga4 ? { ga4Sent: ga4.sent, ga4Failed: ga4.failed } : {}),
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
};

/**
 * Send non-converting browse sessions to GA4 so the conversion rate is realistic.
 *
 * The seed/loop create one converting GA4 session per order, which pins conversion at ~100%.
 * Real shops convert low single digits, so most visitors browse and leave. This floods the
 * property with such sessions (view_item, some add_to_cart / begin_checkout, NO purchase),
 * dated within the Measurement Protocol's 72h window, so the blended conversion rate settles
 * into a believable band. It creates NO orders and no revenue.
 */
const traffic = async (client: CtClient): Promise<void> => {
  const sender = ga4;
  if (!sender) throw new Error('traffic mode needs GA4_MEASUREMENT_ID + GA4_API_SECRET set in .env');
  const pool = await buildPool(client);
  const now = Date.now();
  log('sending non-converting browse sessions', { sessions: SESSIONS, spreadHours: SESSION_SPREAD_HOURS });
  const indices = Array.from({ length: SESSIONS }, (_, i) => i);
  await runPool(indices, CONCURRENCY * 3, async (i) => {
    const r = rng(SEED + hash(`sess:${i}`));
    const region = weightedRegion(r());
    const catalogue = pool.byCurrency[region.currency];
    if (!catalogue || catalogue.length === 0) return;
    const n = 1 + Math.floor(r() * 4);
    const items = Array.from({ length: n }, () => {
      const v = pick(catalogue, r());
      return { item_id: v.sku, item_name: v.name, price: v.prices[region.currency] / 100 };
    }).filter((it) => it.price > 0);
    if (items.length === 0) return;
    const ts = now - Math.floor(r() * SESSION_SPREAD_HOURS * 3600 * 1000);
    await sender.sendRaw(buildBrowsePayload(items, region.currency, SEED + i, ts), now);
    if ((i + 1) % 1000 === 0) {
      log('progress', { done: i + 1, of: SESSIONS, sent: sender.sent, failed: sender.failed, tooOld: sender.skippedTooOld });
    }
  });
  log('traffic complete', { sent: sender.sent, failed: sender.failed, tooOld: sender.skippedTooOld });
};

const cleanup = async (client: CtClient): Promise<void> => {
  log('deleting all SIM- test orders');
  let deleted = 0;
  for (;;) {
    // Always read the first page: each delete removes one, so the window slides down.
    const page = await client.get<{ results: Array<{ id: string; version: number; orderNumber?: string }> }>(
      `/orders?where=${encodeURIComponent(`orderNumber >= "${MARK_PREFIX}" and orderNumber < "${MARK_PREFIX}~"`)}&limit=100`
    );
    if (page.results.length === 0) break;
    for (const order of page.results) {
      if (!order.orderNumber?.startsWith(MARK_PREFIX)) continue;
      await client.delete(`/orders/${order.id}?version=${order.version}`);
      deleted += 1;
      if (deleted % 50 === 0) log('deleting', { deleted });
    }
  }
  log('cleanup complete', { deleted });
};

const ga4Config = readGa4Config(env);
const ga4 = ga4Config ? new Ga4Sender(ga4Config) : null;

/**
 * Ensures the `cost` price custom Type exists (resourceTypeId `product-price`, Money field
 * `cost`), so imported line item prices can carry a per-unit cost. Idempotent: a duplicate-key
 * 409 on a second run is expected and ignored.
 */
const ensureCostType = async (client: CtClient): Promise<void> => {
  try {
    await client.get(`/types/key=${COST_TYPE_KEY}`);
    return; // already present
  } catch {
    // not found — create it
  }
  try {
    await client.post('/types', {
      key: COST_TYPE_KEY,
      name: { en: 'Reporting: price cost' },
      description: { en: 'Per-unit cost of goods carried on a price, for margin reporting.' },
      resourceTypeIds: ['product-price'],
      fieldDefinitions: [
        {
          name: 'cost',
          label: { en: 'Cost of goods (per unit)' },
          required: false,
          type: { name: 'Money' },
          inputHint: 'SingleLine',
        },
      ],
    });
    log('created price cost custom type', { key: COST_TYPE_KEY });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/DuplicateField|already exists|ConcurrentModification|409/i.test(message)) throw error;
  }
};

/**
 * Ensures the order-meta custom Type exists (resourceTypeId `order`), carrying the synthetic
 * promo code + dispatch fields stamped on imported orders. Idempotent.
 */
const ensureOrderMetaType = async (client: CtClient): Promise<void> => {
  try {
    await client.get(`/types/key=${ORDER_META_TYPE_KEY}`);
    return;
  } catch {
    // not found — create it
  }
  try {
    await client.post('/types', {
      key: ORDER_META_TYPE_KEY,
      name: { en: 'Reporting: order metadata' },
      description: { en: 'Synthetic promo code + dispatch fields for reporting (generated data).' },
      resourceTypeIds: ['order'],
      fieldDefinitions: [
        { name: 'promoCode', label: { en: 'Promo code' }, required: false, type: { name: 'String' }, inputHint: 'SingleLine' },
        { name: 'shippedAt', label: { en: 'Shipped at' }, required: false, type: { name: 'DateTime' } },
        { name: 'carrier', label: { en: 'Carrier' }, required: false, type: { name: 'String' }, inputHint: 'SingleLine' },
        { name: 'shippingMethod', label: { en: 'Shipping method' }, required: false, type: { name: 'String' }, inputHint: 'SingleLine' },
      ],
    });
    log('created order-meta custom type', { key: ORDER_META_TYPE_KEY });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/DuplicateField|already exists|ConcurrentModification|409/i.test(message)) throw error;
  }
};

const main = async (): Promise<void> => {
  const client = new CtClient(readConfig(env));
  await ensureCostType(client);
  await ensureOrderMetaType(client);
  if (ga4) log('GA4 Measurement Protocol enabled', { debug: ga4Config!.debug });
  else log('GA4 sending disabled (set GA4_MEASUREMENT_ID + GA4_API_SECRET to enable)');
  const mode = process.argv[2] ?? 'seed';
  if (mode === 'seed') await seed(client);
  else if (mode === 'loop') await loop(client);
  else if (mode === 'traffic') await traffic(client);
  else if (mode === 'cleanup') await cleanup(client);
  else throw new Error(`Unknown mode "${mode}". Use seed | loop | traffic | cleanup.`);
};

main().catch((error) => {
  log('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
