import type { OrderDraftInputs } from './model.js';
import { rng, hash } from './model.js';

/**
 * Sends matching web-analytics events to a real GA4 property via the Measurement Protocol,
 * so the funnel / acquisition reports fill from the SAME activity as the orders and the two
 * reconcile.
 *
 * Hard constraint worth knowing: the Measurement Protocol only accepts events timestamped
 * within the last ~72 hours. Historical days therefore cannot be backfilled into GA4 this
 * way — only recent orders (the live loop, and the last three days of a seed) produce GA4
 * events. The generator logs how many it skipped for being too old rather than pretending.
 *
 * Gated on credentials: with no GA4_MEASUREMENT_ID / GA4_API_SECRET the sender is inert, so
 * the order side works with nothing configured and GA4 lights up the moment they are added.
 */

export interface Ga4Config {
  measurementId: string;
  apiSecret: string;
  /** Use the validation endpoint (no ingestion) — for checking event shape. */
  debug: boolean;
}

export const readGa4Config = (env: NodeJS.ProcessEnv): Ga4Config | null => {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return null;
  return {
    measurementId: env.GA4_MEASUREMENT_ID,
    apiSecret: env.GA4_API_SECRET,
    debug: env.GA4_MP_DEBUG === 'true',
  };
};

/** The Measurement Protocol only accepts events within this window. */
export const MP_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Source/medium pairs, so GA4 derives a spread of default channel groups. */
const TRAFFIC = [
  { source: 'google', medium: 'organic' },
  { source: 'google', medium: 'cpc' },
  { source: '(direct)', medium: '(none)' },
  { source: 'newsletter', medium: 'email' },
  { source: 'facebook', medium: 'paid_social' },
  { source: 'partner-site', medium: 'referral' },
];
const DEVICES = ['desktop', 'mobile', 'tablet'];

export interface Ga4Payload {
  client_id: string;
  timestamp_micros: number;
  events: Array<{ name: string; params: Record<string, unknown> }>;
}

/**
 * Builds a plausible shopper journey for one order: a session with product views, some
 * add-to-carts, a checkout start and the purchase. This is the funnel the reports render;
 * the drop-off between steps is what makes the funnel chart meaningful.
 */
export const buildGa4Payload = (order: OrderDraftInputs, seed: number): Ga4Payload => {
  const r = rng(seed + hash(order.orderNumber));
  const clientId = `${Math.floor(r() * 1e10)}.${Math.floor(r() * 1e10)}`;
  const completedMs = Date.parse(order.completedAt);
  const sessionId = String(Math.floor(completedMs / 1000));
  const traffic = TRAFFIC[Math.floor(r() * TRAFFIC.length)];
  const device = DEVICES[Math.floor(r() * DEVICES.length)];

  const items = order.lines.map((l) => ({
    item_id: l.variant.sku,
    item_name: l.variant.name,
    price: l.unitPrice / 100,
    quantity: l.quantity,
  }));
  const value = order.lines.reduce((s, l) => s + (l.unitPrice / 100) * l.quantity, 0);
  const common = {
    session_id: sessionId,
    engagement_time_msec: 1,
    source: traffic.source,
    medium: traffic.medium,
    // GA4 largely infers device from a user agent, which server events lack; passing a hint
    // is best-effort and documented as approximate.
    device_category: device,
  };

  // NB: `session_start` is a RESERVED Measurement Protocol event name and is rejected.
  // GA4 establishes the session from the `session_id` param on the events below instead.
  const events: Ga4Payload['events'] = [
    ...items.map((item) => ({
      name: 'view_item',
      params: { ...common, currency: order.currency, value: item.price, items: [item] },
    })),
    // Not every viewed item is added: model a realistic add-to-cart drop-off.
    ...items
      .filter(() => r() < 0.7)
      .map((item) => ({
        name: 'add_to_cart',
        params: { ...common, currency: order.currency, value: item.price, items: [item] },
      })),
    { name: 'begin_checkout', params: { ...common, currency: order.currency, value, items } },
    {
      name: 'purchase',
      params: {
        ...common,
        currency: order.currency,
        value,
        transaction_id: order.orderNumber,
        items,
      },
    },
  ];

  return { client_id: clientId, timestamp_micros: completedMs * 1000, events };
};

export const isWithinMpWindow = (order: OrderDraftInputs, now = Date.now()): boolean =>
  now - Date.parse(order.completedAt) < MP_MAX_AGE_MS;

export class Ga4Sender {
  sent = 0;
  skippedTooOld = 0;
  failed = 0;

  constructor(private readonly config: Ga4Config) {}

  private endpoint(): string {
    const host = 'https://www.google-analytics.com';
    const path = this.config.debug ? '/debug/mp/collect' : '/mp/collect';
    return `${host}${path}?measurement_id=${encodeURIComponent(this.config.measurementId)}&api_secret=${encodeURIComponent(this.config.apiSecret)}`;
  }

  async send(order: OrderDraftInputs, seed: number, now = Date.now()): Promise<'sent' | 'too-old' | 'failed'> {
    if (!isWithinMpWindow(order, now)) {
      this.skippedTooOld += 1;
      return 'too-old';
    }
    const payload = buildGa4Payload(order, seed);
    try {
      const response = await fetch(this.endpoint(), { method: 'POST', body: JSON.stringify(payload) });
      // The debug endpoint returns 200 with a validationMessages array; a non-empty array
      // means the event shape is wrong and would be silently dropped by the live endpoint.
      if (this.config.debug) {
        const body = (await response.json()) as { validationMessages?: unknown[] };
        if (body.validationMessages && body.validationMessages.length > 0) {
          this.failed += 1;
          return 'failed';
        }
      } else if (!response.ok) {
        this.failed += 1;
        return 'failed';
      }
      this.sent += 1;
      return 'sent';
    } catch {
      this.failed += 1;
      return 'failed';
    }
  }
}
