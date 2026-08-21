import { loadEnv } from './load-env.js';
loadEnv();

import { CtClient, readConfig } from './ct.js';
import { Ga4Sender, readGa4Config } from './ga4.js';
import {
  MARK_PREFIX,
  REGIONS,
  hash,
  pick,
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

  const lineCount = 1 + Math.floor(r() * 4);
  const lines = Array.from({ length: lineCount }, () => {
    const variant = pick(catalogue, r());
    return { variant, quantity: 1 + Math.floor(r() * 3), unitPrice: variant.prices[region.currency] };
  }).filter((l) => l.unitPrice > 0);
  if (lines.length === 0) return null;

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

  return {
    orderNumber: `${MARK_PREFIX}${completedAt.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`,
    // Spread the completion time across the working day for a touch of realism.
    completedAt: `${completedAt}T${String(8 + Math.floor(r() * 11)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00.000Z`,
    currency: region.currency,
    country,
    ...(channelKey ? { channelKey } : {}),
    ...(storeKey ? { storeKey } : {}),
    lines,
  };
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
    if (ga4 && outcome !== 'failed') await ga4.send(draft, SEED);
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
        if (ga4 && outcome !== 'failed') await ga4.send(draft, SEED);
      }
    }
    tick += 1;
    log('live tick', {
      tick,
      added: LOOP_ORDERS,
      ...(ga4 ? { ga4Sent: ga4.sent, ga4Failed: ga4.failed } : {}),
    });
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
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

const main = async (): Promise<void> => {
  const client = new CtClient(readConfig(env));
  if (ga4) log('GA4 Measurement Protocol enabled', { debug: ga4Config!.debug });
  else log('GA4 sending disabled (set GA4_MEASUREMENT_ID + GA4_API_SECRET to enable)');
  const mode = process.argv[2] ?? 'seed';
  if (mode === 'seed') await seed(client);
  else if (mode === 'loop') await loop(client);
  else if (mode === 'cleanup') await cleanup(client);
  else throw new Error(`Unknown mode "${mode}". Use seed | loop | cleanup.`);
};

main().catch((error) => {
  log('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
