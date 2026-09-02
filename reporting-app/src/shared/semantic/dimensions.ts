import type { DimensionDef } from './types';

/**
 * The dimension registry.
 *
 * `conformed: true` + an identical `canonicalKeyDefinition` on every participating source
 * is the ONLY licence to join across sources. Everything else is single-source only.
 */
const defs: DimensionDef[] = [
  // ── Time ────────────────────────────────────────────────────────────────────────
  {
    id: 'date',
    labelKey: 'dimension.date',
    keyType: 'date',
    conformed: true,
    canonicalKeyDefinition: 'iso-8601-date',
    cardinalityHint: 'medium',
  },

  // ── Conformed commerce dimensions ───────────────────────────────────────────────
  {
    id: 'currency',
    labelKey: 'dimension.currency',
    keyType: 'enum',
    conformed: true,
    canonicalKeyDefinition: 'iso-4217',
    cardinalityHint: 'low',
  },
  {
    id: 'country',
    labelKey: 'dimension.country',
    keyType: 'enum',
    conformed: true,
    canonicalKeyDefinition: 'iso-3166-1-alpha2',
    cardinalityHint: 'low',
  },
  {
    id: 'store',
    labelKey: 'dimension.store',
    keyType: 'reference',
    reference: { resourceType: 'store' },
    conformed: true,
    canonicalKeyDefinition: 'commercetools:store.key',
    cardinalityHint: 'low',
  },
  {
    id: 'product',
    labelKey: 'dimension.product',
    keyType: 'reference',
    reference: { resourceType: 'product' },
    conformed: true,
    canonicalKeyDefinition: 'commercetools:variant.sku',
    cardinalityHint: 'high',
  },
  {
    id: 'category',
    labelKey: 'dimension.category',
    keyType: 'reference',
    reference: { resourceType: 'category' },
    conformed: true,
    canonicalKeyDefinition: 'commercetools:category.key',
    cardinalityHint: 'medium',
  },
  {
    id: 'device',
    labelKey: 'dimension.device',
    keyType: 'enum',
    conformed: true,
    canonicalKeyDefinition: 'device-category:desktop|mobile|tablet',
    cardinalityHint: 'low',
  },

  // ── commercetools-only dimensions (NOT conformed) ───────────────────────────────
  //
  // `distributionChannel` is a commercetools sales channel. It is deliberately NOT
  // conformed with GA4's `trafficChannel`, which is a marketing acquisition channel.
  // They are different concepts; conflating them is the classic silent-wrongness bug
  // in this class of tool.
  {
    id: 'distributionChannel',
    labelKey: 'dimension.distributionChannel',
    keyType: 'reference',
    reference: { resourceType: 'channel' },
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'customerGroup',
    labelKey: 'dimension.customerGroup',
    keyType: 'reference',
    reference: { resourceType: 'customer-group' },
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'businessUnit',
    labelKey: 'dimension.businessUnit',
    keyType: 'reference',
    reference: { resourceType: 'business-unit' },
    conformed: false,
    cardinalityHint: 'medium',
  },
  {
    id: 'orderState',
    labelKey: 'dimension.orderState',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'paymentState',
    labelKey: 'dimension.paymentState',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'shipmentState',
    labelKey: 'dimension.shipmentState',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'paymentMethod',
    labelKey: 'dimension.paymentMethod',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'shippingMethod',
    labelKey: 'dimension.shippingMethod',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'discountCode',
    labelKey: 'dimension.discountCode',
    keyType: 'reference',
    reference: { resourceType: 'discount-code' },
    conformed: false,
    cardinalityHint: 'medium',
  },
  {
    id: 'cartDiscount',
    labelKey: 'dimension.cartDiscount',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'medium',
  },
  {
    id: 'customerType',
    labelKey: 'dimension.customerType',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'cohortMonth',
    labelKey: 'dimension.cohortMonth',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'medium',
  },
  {
    id: 'periodIndex',
    labelKey: 'dimension.periodIndex',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'rfmSegment',
    labelKey: 'dimension.rfmSegment',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'returnReason',
    labelKey: 'dimension.returnReason',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'brand',
    labelKey: 'dimension.brand',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'medium',
  },
  {
    id: 'productType',
    labelKey: 'dimension.productType',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'priceBand',
    labelKey: 'dimension.priceBand',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'ageBucket',
    labelKey: 'dimension.ageBucket',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },

  // ── Web-analytics dimensions (NOT conformed with commerce) ──────────────────────
  {
    id: 'trafficChannel',
    labelKey: 'dimension.trafficChannel',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'sourceMedium',
    labelKey: 'dimension.sourceMedium',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'high',
  },
  {
    id: 'campaign',
    labelKey: 'dimension.campaign',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'high',
  },
  {
    id: 'landingPage',
    labelKey: 'dimension.landingPage',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'unbounded',
  },
  {
    id: 'searchTerm',
    labelKey: 'dimension.searchTerm',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'unbounded',
  },
  {
    id: 'funnelStep',
    labelKey: 'dimension.funnelStep',
    keyType: 'enum',
    conformed: false,
    cardinalityHint: 'low',
  },

  // ── ERP / OMS / supply dimensions ──────────────────────────────────────────────
  {
    id: 'warehouse',
    labelKey: 'dimension.warehouse',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
  {
    id: 'supplier',
    labelKey: 'dimension.supplier',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'medium',
  },
  {
    id: 'carrier',
    labelKey: 'dimension.carrier',
    keyType: 'string',
    conformed: false,
    cardinalityHint: 'low',
  },
];

export const DIMENSIONS: Readonly<Record<string, DimensionDef>> = Object.freeze(
  Object.fromEntries(defs.map((d) => [d.id, Object.freeze(d)]))
);

export const getDimension = (id: string): DimensionDef | undefined => DIMENSIONS[id];

export const CONFORMED_DIMENSIONS: readonly string[] = Object.freeze(
  defs.filter((d) => d.conformed).map((d) => d.id)
);

export const isConformed = (id: string): boolean => DIMENSIONS[id]?.conformed === true;
