import type { FactCell, OrderFact } from './keying.js';
import { bucketDay } from '../util/date-range.js';
import { stableHash } from '../util/hash.js';

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
  /**
   * The payment lifecycle state (Paid, Pending, CreditOwed, Failed, BalanceDue). Carried as a
   * reporting dimension, and the signal for a refund: a `CreditOwed` order is treated as fully
   * refunded (see orderMeasures). A missing value is NONE, so live orders without one are
   * unaffected.
   */
  paymentState?: string | null;
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
  /**
   * Order-level custom fields carrying synthetic reporting metadata written by the generator:
   * `promoCode` (promotion applied), and `shippedAt`/`carrier`/`shippingMethod` (dispatch). The
   * scan selects them via `custom { customFieldsRaw(includeNames:[...]) { name value } }`.
   */
  custom?: { customFieldsRaw?: Array<{ name: string; value?: unknown }> | null } | null;
  lineItems?: Array<{
    quantity: number;
    productId?: string | null;
    variant?: { sku?: string | null } | null;
    name?: Record<string, string> | null;
    distributionChannel?: { key?: string | null } | null;
    /**
     * The line item's price snapshot. `custom.customFieldsRaw` carries the `cost` custom field
     * (a Money) captured at order time — the unit cost of goods. The scan selects it with
     * `price { value { centAmount } custom { customFieldsRaw(includeNames:["cost"]) { name value } } }`.
     */
    price?: {
      value?: { centAmount: number } | null;
      custom?: { customFieldsRaw?: Array<{ name: string; value?: unknown }> | null } | null;
    } | null;
    totalPrice?: { centAmount: number } | null;
    /**
     * The product's reporting category key. An order line does not carry this — it is
     * resolved from the product (productId → category) and attached by applyLineCategories()
     * before the fact is built, so the item-grain cubes can key on it.
     */
    category?: string | null;
  }> | null;
}

/** Placeholder for a dimension the order does not carry, so keys are never empty strings. */
export const NONE = '_none';

/** Dispatch SLA: a shipment is "on time" when shipped within this many days of the order. */
export const DISPATCH_SLA_DAYS = 2;

/** Read a string order-level custom field (promoCode / carrier / shippingMethod / shippedAt). */
const orderCustomField = (order: OrderProjection, name: string): string | undefined => {
  const raw = (order.custom?.customFieldsRaw ?? []).find((f) => f.name === name)?.value;
  return raw === null || raw === undefined ? undefined : String(raw);
};

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

/**
 * Unit cost of goods for a line, read from its price's `cost` custom field (a Money captured at
 * order time). Returns 0 when the order carries no cost — advertised cost reads as "none" rather
 * than wrong, exactly like the other not-yet-populated measures.
 */
const lineUnitCost = (line: { price?: { custom?: { customFieldsRaw?: Array<{ name: string; value?: unknown }> | null } | null } | null }): number => {
  const raw = (line.price?.custom?.customFieldsRaw ?? []).find((f) => f.name === 'cost')?.value;
  if (raw && typeof raw === 'object' && 'centAmount' in raw) {
    const n = Number((raw as { centAmount?: unknown }).centAmount);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

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
  // Refund convention: `CreditOwed` means the balance is owed back to the customer, i.e. the
  // order was refunded. We treat it as a full refund of net — the only refund signal the
  // projection carries. revenue.net@orderdate still books the sale on the order date; the
  // refund lands in refunds.value@cashdate, exactly the restatement split the metrics model.
  const refunds = order.paymentState === 'CreditOwed' ? net : 0;

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
    refunds,
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
 * Attaches each line's product category (a key) to the projection, in place.
 *
 * An order line carries only `productId`, not the product's category, so category is resolved
 * from the product and applied here before the fact is built. `categoryOf` is a pure lookup
 * supplied by the caller (see shared-node/category-resolver), which keeps this function — and
 * toOrderFact — free of any commercetools I/O and therefore trivially testable.
 */
export const applyLineCategories = (
  order: OrderProjection,
  categoryOf: (productId?: string | null) => string
): void => {
  for (const line of order.lineItems ?? []) {
    line.category = categoryOf(line.productId);
  }
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

  // Opaque per-customer key for cohort grouping: the real customerId when present, else a hash
  // of the email (guest orders), else '' — never the raw email, so no PII enters the fact store.
  const customerRaw = order.customerId ?? order.customerEmail ?? '';
  const customerKey = customerRaw ? stableHash(customerRaw) : '';

  // Promotion: the code applied (from the order custom field), if any.
  const promoCode = orderCustomField(order, 'promoCode') ?? NONE;
  const redemptions = promoCode !== NONE ? 1 : 0;

  // Fulfilment: a synthetic dispatch stamped on fulfilled orders. On time when shipped within
  // the SLA of the order date. Counts feed the fulfilment-daily cube (shipments.count/onTime).
  const shippedAt = orderCustomField(order, 'shippedAt');
  const shipments = shippedAt ? 1 : 0;
  const shippedOnTime =
    shippedAt &&
    Date.parse(shippedAt.slice(0, 10)) - Date.parse(businessDate) <= DISPATCH_SLA_DAYS * 86_400_000
      ? 1
      : 0;

  return {
    schemaVersion: 1,
    orderId: order.id,
    orderVersion: order.version,
    lastSequenceNumber: order.version,
    businessDate,
    cashDates: [businessDate],
    customerKey,
    dims: {
      currency: measures.currency,
      store: order.store?.key ?? NONE,
      // Keyed by the CANONICAL dimension id so the reader's group-by finds it. (An earlier
      // version used 'channel', which silently produced empty channel breakdowns.)
      distributionChannel: channelOf(order),
      country: order.country ?? NONE,
      orderState: order.orderState ?? NONE,
      paymentState: order.paymentState ?? NONE,
      discountCode: promoCode,
      shippingMethod: orderCustomField(order, 'shippingMethod') ?? NONE,
      carrier: orderCustomField(order, 'carrier') ?? NONE,
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
      // An order is "promoted" if it carries a real discount code / order discount (measures)
      // OR a synthetic promo code custom field (redemptions). Without the latter, imported demo
      // orders — which record the promo as a custom field, not a real CartDiscount — never count.
      ordersPromoted: measures.ordersPromoted || redemptions,
      redemptions,
      shipments,
      shipmentsOnTime: shippedOnTime,
      // Left to a future pass; advertised metrics that read 0 are handled as "none" by the
      // additive path rather than being wrong.
      customersNew: 0,
    },
    items: (order.lineItems ?? []).map((line) => ({
      sku: line.variant?.sku ?? line.productId ?? NONE,
      // Resolved from the product by applyLineCategories() before this runs; NONE if the
      // product has no category or resolution was skipped.
      category: line.category ?? NONE,
      units: line.quantity ?? 0,
      revenueNet: centAmount(line.totalPrice),
      returnsUnits: 0,
      // Cost of goods for the line: unit cost (from the price's `cost` custom field) x quantity.
      cost: lineUnitCost(line) * (line.quantity ?? 0),
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
      paymentState: fact.dims.paymentState ?? NONE,
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
      cell.m.cost = (cell.m.cost ?? 0) + (item.cost ?? 0);
      byKey.set(mapKey, cell);
    }
  }

  return [...byKey.values()];
};

/**
 * Folds order-facts into the `order-categories-daily` cube: units and net revenue per category.
 *
 * A SEPARATE cube from order-lines-daily on purpose. order-lines-daily is capped at top-N SKUs
 * per store, so its `__other__` residual would strip category attribution off the long tail —
 * a category total read from it would undercount categories made of many small sellers.
 * Categories are low-cardinality, so this cube needs no top-N and stays complete and exact.
 */
export const foldOrderCategoriesDaily = (facts: OrderFact[]): FactCell[] => {
  const byKey = new Map<string, FactCell>();

  for (const fact of facts) {
    for (const item of fact.items ?? []) {
      const k = { currency: fact.dims.currency, store: fact.dims.store, category: item.category };
      const mapKey = Object.values(k).join('');
      const cell: FactCell = byKey.get(mapKey) ?? { k, m: {} };
      cell.m.units = (cell.m.units ?? 0) + item.units;
      cell.m.revenueNet = (cell.m.revenueNet ?? 0) + item.revenueNet;
      cell.m.returnsUnits = (cell.m.returnsUnits ?? 0) + item.returnsUnits;
      cell.m.cost = (cell.m.cost ?? 0) + (item.cost ?? 0);
      byKey.set(mapKey, cell);
    }
  }

  return [...byKey.values()];
};

/**
 * Folds order-facts into the `promotions-daily` cube: discount-code redemptions per code.
 *
 * Only orders that carried a promo code contribute. Keyed by the conformed discount dimensions
 * (currency, store, discountCode) so promotion-effectiveness can break redemptions down by code.
 */
export const foldPromotionsDaily = (facts: OrderFact[]): FactCell[] => {
  const byKey = new Map<string, FactCell>();

  for (const fact of facts) {
    if ((fact.measures.redemptions ?? 0) <= 0) continue; // only promoted orders
    const k = {
      currency: fact.dims.currency,
      store: fact.dims.store,
      discountCode: fact.dims.discountCode ?? NONE,
    };
    const mapKey = Object.values(k).join('');
    const cell: FactCell = byKey.get(mapKey) ?? { k, m: {} };
    cell.m.redemptions = (cell.m.redemptions ?? 0) + (fact.measures.redemptions ?? 0);
    cell.m.ordersPromoted = (cell.m.ordersPromoted ?? 0) + (fact.measures.ordersPromoted ?? 0);
    cell.m.discount = (cell.m.discount ?? 0) + (fact.measures.discount ?? 0);
    byKey.set(mapKey, cell);
  }

  return [...byKey.values()];
};

/**
 * Folds order-facts into the `fulfilment-daily` cube: shipment counts + on-time counts.
 *
 * Only orders with a dispatch (a shipment) contribute. Keyed by (store, shippingMethod) so the
 * fulfilment SLA report can break dispatch performance down by method. `shipments.onTime` is a
 * count; the on-time RATE is a derived metric (onTime / count) computed after aggregation.
 */
export const foldFulfilmentDaily = (facts: OrderFact[]): FactCell[] => {
  const byKey = new Map<string, FactCell>();

  for (const fact of facts) {
    if ((fact.measures.shipments ?? 0) <= 0) continue; // only shipped orders
    const k = {
      store: fact.dims.store,
      shippingMethod: fact.dims.shippingMethod ?? NONE,
      carrier: fact.dims.carrier ?? NONE,
    };
    const mapKey = Object.values(k).join('\u0000');
    const cell: FactCell = byKey.get(mapKey) ?? { k, m: {} };
    cell.m.shipments = (cell.m.shipments ?? 0) + (fact.measures.shipments ?? 0);
    cell.m.shipmentsOnTime = (cell.m.shipmentsOnTime ?? 0) + (fact.measures.shipmentsOnTime ?? 0);
    byKey.set(mapKey, cell);
  }

  return [...byKey.values()];
};

/** Whole months between two YYYY-MM strings (b - a); negative if b precedes a. */
const monthDiff = (a: string, b: string): number => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};

/** YYYY-MM that is `n` months after the YYYY-MM `start`. */
const addMonths = (start: string, n: number): string => {
  const [y, m] = start.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
};

/**
 * Reduces the FULL order-fact history into the cohort-retention matrix (the `customers-daily`
 * snapshot cube). Unlike every other fold this is NOT per-day: cohort membership is a customer's
 * FIRST order month across all time, and retention counts DISTINCT customers, so it must see a
 * customer's whole history at once.
 *
 * Each customer is assigned to one cohort — (first-order month, first-order store) — and counted
 * at most once per period, so summing cells over `store` can never double-count. A cell is emitted
 * for every elapsed period (0..latest) with `cohortSize` (the cohort's distinct customers, the
 * retention denominator, repeated on each row) and `retained` (distinct members active that
 * period). No cell is emitted for a period that has not elapsed yet, so `retention.rate` is blank
 * there rather than a misleading 0 — matching `customers.retained`'s null semantics.
 */
export const foldCohort = (facts: OrderFact[]): FactCell[] => {
  interface Cust {
    firstDate: string;
    firstStore: string;
    months: Set<string>;
  }
  const byCustomer = new Map<string, Cust>();
  let latestMonth = '';

  for (const fact of facts) {
    const key = fact.customerKey;
    if (!key) continue; // guest / unattributable order — not a cohort member
    const month = fact.businessDate.slice(0, 7);
    if (month > latestMonth) latestMonth = month;
    const existing = byCustomer.get(key);
    if (!existing) {
      byCustomer.set(key, {
        firstDate: fact.businessDate,
        firstStore: fact.dims.store ?? NONE,
        months: new Set([month]),
      });
    } else {
      existing.months.add(month);
      if (fact.businessDate < existing.firstDate) {
        existing.firstDate = fact.businessDate;
        existing.firstStore = fact.dims.store ?? NONE;
      }
    }
  }

  if (!latestMonth) return [];

  // Group customers into cohorts keyed by (first-order month, first-order store).
  const cohorts = new Map<string, { cohortMonth: string; store: string; members: Cust[] }>();
  for (const cust of byCustomer.values()) {
    const cohortMonth = cust.firstDate.slice(0, 7);
    const mapKey = `${cohortMonth}\u0000${cust.firstStore}`;
    const cohort = cohorts.get(mapKey) ?? { cohortMonth, store: cust.firstStore, members: [] };
    cohort.members.push(cust);
    cohorts.set(mapKey, cohort);
  }

  const cells: FactCell[] = [];
  for (const { cohortMonth, store, members } of cohorts.values()) {
    const cohortSize = members.length;
    const maxPeriod = monthDiff(cohortMonth, latestMonth);
    for (let period = 0; period <= maxPeriod; period += 1) {
      const targetMonth = addMonths(cohortMonth, period);
      const retained = members.reduce((n, m) => (m.months.has(targetMonth) ? n + 1 : n), 0);
      cells.push({
        k: { cohortMonth, periodIndex: String(period), store },
        m: { cohortSize, retained },
      });
    }
  }
  return cells;
};
