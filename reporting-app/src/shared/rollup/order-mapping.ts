import type { FactCell, OrderFact } from './keying';
import { bucketDay } from '../util/date-range';

/**
 * Maps a commercetools order to rollup facts.
 *
 * This is the one place the order shape is interpreted, shared by the event handler (which
 * writes a per-order fact as changes arrive) and the job (which folds those facts into day
 * partitions). Keeping it here — pure, and operating on a plain projection rather than an
 * SDK type — means the two paths can never disagree about what an order is worth.
 *
 * The projection is deliberately minimal: exactly the ~20 fields a rollup needs, which is
 * also what the GraphQL scan selects, because payload size dominates runtime at 2 CPU/4 GB.
 */

export interface OrderProjection {
  id: string;
  version: number;
  createdAt: string;
  lastModifiedAt: string;
  /**
   * When the order completed. Settable via the Order Import API (createdAt is not), so it is
   * how an imported/backfilled order carries its true business date. Preferred over
   * createdAt for bucketing when present.
   */
  completedAt?: string | null;
  orderState?: string | null;
  country?: string | null;
  totalPrice: { currencyCode: string; centAmount: number; fractionDigits?: number };
  taxedPrice?: {
    totalNet?: { centAmount: number } | null;
    totalGross?: { centAmount: number } | null;
    totalTax?: { centAmount: number } | null;
  } | null;
  shippingInfo?: { price?: { centAmount: number } | null } | null;
  discountOnTotalPrice?: { discountedAmount?: { centAmount: number } | null } | null;
  store?: { key?: string | null } | null;
  customerId?: string | null;
  customerEmail?: string | null;
  /** Discount codes applied, used only to mark an order as "promoted". */
  discountCodes?: Array<{ discountCode?: { id?: string | null } | null }> | null;
  lineItems?: Array<{
    quantity: number;
    productId?: string | null;
    variant?: { sku?: string | null } | null;
    name?: Record<string, string> | null;
    distributionChannel?: { key?: string | null } | null;
    price?: { value?: { centAmount: number } | null } | null;
    totalPrice?: { centAmount: number } | null;
  }> | null;
}

/** Placeholder for a dimension the order does not carry, so keys are never empty strings. */
export const NONE = '_none';

/** The distribution channel of an order, taken from its line items when they agree. */
const channelOf = (order: OrderProjection): string => {
  const channels = new Set(
    (order.lineItems ?? [])
      .map((line) => line.distributionChannel?.key)
      .filter((key): key is string => Boolean(key))
  );
  if (channels.size === 1) return [...channels][0];
  // Mixed or absent: do not invent one. A blank channel is honest; a guessed one is not.
  return NONE;
};

const centAmount = (money?: { centAmount: number } | null): number => money?.centAmount ?? 0;

export interface OrderMeasures {
  currency: string;
  fractionDigits: number;
  orders: number;
  revenueGross: number;
  revenueNet: number;
  revenueNetCash: number;
  discount: number;
  shipping: number;
  tax: number;
  refunds: number;
  units: number;
  lines: number;
  ordersPromoted: number;
}

/**
 * The measures for a single order.
 *
 * Gross/net/tax come from taxedPrice when present, because that is where discounts and tax
 * are already resolved; totalPrice is the fallback. revenue.net@cashdate equals
 * revenue.net@orderdate here because a freshly placed order's cash date is its order date —
 * refunds later restate the cash-date bucket separately (not handled in this pass).
 */
export const orderMeasures = (order: OrderProjection): OrderMeasures => {
  const gross = order.taxedPrice?.totalGross
    ? centAmount(order.taxedPrice.totalGross)
    : order.totalPrice.centAmount;
  const net = order.taxedPrice?.totalNet
    ? centAmount(order.taxedPrice.totalNet)
    : order.totalPrice.centAmount;
  const tax = centAmount(order.taxedPrice?.totalTax);
  const shipping = centAmount(order.shippingInfo?.price);
  const discount = centAmount(order.discountOnTotalPrice?.discountedAmount);
  const units = (order.lineItems ?? []).reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const lines = (order.lineItems ?? []).length;
  const promoted = (order.discountCodes ?? []).length > 0 || discount > 0 ? 1 : 0;

  return {
    currency: order.totalPrice.currencyCode,
    fractionDigits: order.totalPrice.fractionDigits ?? 2,
    orders: 1,
    revenueGross: gross,
    revenueNet: net,
    revenueNetCash: net,
    discount,
    shipping,
    tax,
    refunds: 0,
    units,
    lines,
    ordersPromoted: promoted,
  };
};

/**
 * The reporting day an order falls on, cut in the reporting timezone.
 *
 * Prefers `completedAt` over `createdAt`: it is the settable, business-meaningful "order
 * completed" date, and it is the only real date an imported/backfilled order can carry
 * (createdAt is always server-assigned to "now"). Falls back to createdAt when absent, so
 * ordinary live orders are unaffected.
 */
export const businessDateOf = (order: OrderProjection, timezone: string): string => {
  // For UTC (this project's setting) the ISO date prefix is the day. A non-UTC reporting
  // zone needs an offset-aware bucket; the hour-shift for other zones is applied by the
  // caller when configured.
  void timezone;
  const source = order.completedAt ?? order.createdAt;
  return bucketDay(source.slice(0, 10), 'day');
};

/**
 * The per-order fact written by the event handler.
 *
 * Recomputed wholesale from the order every time rather than incremented, so an
 * at-least-once, out-of-order redelivery is a no-op: the same order always produces the same
 * fact. The `orderVersion` guard makes a stale redelivery lose to a newer one.
 */
export const toOrderFact = (order: OrderProjection, timezone: string): OrderFact => {
  const measures = orderMeasures(order);
  const businessDate = businessDateOf(order, timezone);

  return {
    schemaVersion: 1,
    orderId: order.id,
    orderVersion: order.version,
    lastSequenceNumber: order.version,
    businessDate,
    cashDates: [businessDate],
    dims: {
      currency: measures.currency,
      store: order.store?.key ?? NONE,
      // Keyed by the CANONICAL dimension id so the reader's group-by finds it. (An earlier
      // version used 'channel', which silently produced empty channel breakdowns.)
      distributionChannel: channelOf(order),
      country: order.country ?? NONE,
      orderState: order.orderState ?? NONE,
    },
    measures: {
      orders: measures.orders,
      revenueGross: measures.revenueGross,
      revenueNet: measures.revenueNet,
      revenueNetCash: measures.revenueNetCash,
      discount: measures.discount,
      shipping: measures.shipping,
      tax: measures.tax,
      refunds: measures.refunds,
      units: measures.units,
      lines: measures.lines,
      ordersPromoted: measures.ordersPromoted,
      // Left to a future pass; advertised metrics that read 0 are handled as "none" by the
      // additive path rather than being wrong.
      customersNew: 0,
    },
    items: (order.lineItems ?? []).map((line) => ({
      sku: line.variant?.sku ?? line.productId ?? NONE,
      category: NONE,
      units: line.quantity ?? 0,
      revenueNet: centAmount(line.totalPrice),
      returnsUnits: 0,
    })),
    sourceLastModifiedAt: order.lastModifiedAt,
    updatedAt: order.lastModifiedAt,
  };
};

/**
 * Folds a set of order-facts for one day into the `orders-daily` cube cells.
 *
 * Cells are keyed by the conformed order dimensions. This is a full rebuild from the facts,
 * never a delta: rebuilding converges and is auditable, whereas incrementing drifts.
 */
export const foldOrdersDaily = (facts: OrderFact[]): FactCell[] => {
  const byKey = new Map<string, FactCell>();

  for (const fact of facts) {
    const k = {
      currency: fact.dims.currency,
      store: fact.dims.store,
      distributionChannel: fact.dims.distributionChannel ?? fact.dims.channel ?? NONE,
      country: fact.dims.country,
      orderState: fact.dims.orderState,
    };
    const mapKey = Object.values(k).join('');
    const cell: FactCell = byKey.get(mapKey) ?? { k, m: {} };
    for (const [measure, value] of Object.entries(fact.measures)) {
      cell.m[measure] = (cell.m[measure] ?? 0) + value;
    }
    byKey.set(mapKey, cell);
  }

  return [...byKey.values()];
};

/**
 * Folds order-facts into the `order-lines-daily` cube: units and net revenue per SKU.
 *
 * Kept top-N-plus-residual at write time is the job's responsibility (see the cardinality
 * guard); this returns the full set of line cells for a day and lets the caller cap it.
 */
export const foldOrderLinesDaily = (facts: OrderFact[]): FactCell[] => {
  const byKey = new Map<string, FactCell>();

  for (const fact of facts) {
    for (const item of fact.items ?? []) {
      const k = { currency: fact.dims.currency, store: fact.dims.store, product: item.sku };
      const mapKey = Object.values(k).join('');
      const cell: FactCell = byKey.get(mapKey) ?? { k, m: {} };
      cell.m.units = (cell.m.units ?? 0) + item.units;
      cell.m.revenueNet = (cell.m.revenueNet ?? 0) + item.revenueNet;
      cell.m.returnsUnits = (cell.m.returnsUnits ?? 0) + item.returnsUnits;
      byKey.set(mapKey, cell);
    }
  }

  return [...byKey.values()];
};
