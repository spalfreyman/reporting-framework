/**
 * The semantic model: metric and dimension definitions.
 *
 * Metric ids are SOURCE-NEUTRAL. Sources advertise *coverage* of registry ids; they never
 * define metrics. That is what makes "swap Custom Object rollups for a warehouse" a config
 * change rather than a rewrite.
 */

export const GRAINS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;
export type Grain = (typeof GRAINS)[number];

/** Coarse-to-fine ordering. Roll-UP is legal for additive metrics; roll-DOWN never is. */
const GRAIN_ORDER: Record<Grain, number> = {
  hour: 0,
  day: 1,
  week: 2,
  month: 3,
  quarter: 4,
  year: 5,
};

export const isCoarserOrEqual = (a: Grain, b: Grain): boolean =>
  GRAIN_ORDER[a] >= GRAIN_ORDER[b];

/** The coarsest of a set — the grain a multi-source tile must fall back to. */
export const coarsestGrain = (grains: Grain[]): Grain =>
  grains.reduce((worst, g) => (GRAIN_ORDER[g] > GRAIN_ORDER[worst] ? g : worst), grains[0]);

export const finestGrain = (grains: Grain[]): Grain =>
  grains.reduce((best, g) => (GRAIN_ORDER[g] < GRAIN_ORDER[best] ? g : best), grains[0]);

export type ValueType =
  | 'money'
  | 'count'
  | 'ratio'
  | 'percent'
  | 'duration_s'
  | 'string'
  | 'bool'
  | 'time';

export type AggRule =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'
  | 'countDistinct'
  | 'last'
  | 'ratio'
  | 'nonAdditive';

export type SourceDomain =
  | 'commerce'
  | 'web-analytics'
  | 'erp'
  | 'oms'
  | 'warehouse'
  | 'custom';

/**
 * Formula as an AST rather than a closure or a string, so the planner can statically
 * flatten a derived metric to its leaf metrics WITHOUT executing it. That static analysis
 * is what makes source resolution and the availability lattice possible.
 */
export type Formula =
  | { op: 'ref'; metric: string }
  | { op: 'const'; value: number }
  | { op: 'add'; left: Formula; right: Formula }
  | { op: 'sub'; left: Formula; right: Formula }
  | { op: 'mul'; left: Formula; right: Formula }
  /** Denominator 0 or nullish yields null — never 0, NaN or Infinity. */
  | { op: 'safeRatio'; num: Formula; den: Formula };

export interface MetricFormat {
  style: 'money' | 'integer' | 'decimal' | 'percent' | 'duration';
  precision?: number;
}

interface MetricCommon {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  valueType: ValueType;
  domains: SourceDomain[];
  format: MetricFormat;
  /** Whether a rising value is good. Drives KPI delta colouring: a rising return rate is bad. */
  higherIsBetter?: boolean;
  /** null means "unknown"; zero means "genuinely none". Changes how gaps render. */
  nullSemantics: 'zero' | 'null';
  /**
   * Sensitivity group, e.g. 'financials'. A wildcard capability grant ('metric:*') does
   * NOT cover a sensitive metric: it requires an explicit `metric:<id>` or
   * `sensitivity:<group>` grant. This makes wildcards safe to hand out.
   */
  sensitivity?: string;
  deprecated?: { since: string; replacedBy?: string };
}

export interface BaseMetric extends MetricCommon {
  kind: 'base';
  aggregation: AggRule;
  additive: { overTime: boolean; overDimensions: boolean };
  /** Finest grain at which this metric is semantically meaningful. */
  minGrain?: Grain;
  /** Money metrics are only valid within a single currency. */
  currencyScoped?: boolean;
}

export interface DerivedMetric extends MetricCommon {
  kind: 'derived';
  formula: Formula;
  /**
   * Ratio of sums, never sum of ratios. 'preAggregate' exists for row-level derivations
   * that are then summed, and requires the result to be additive over time.
   */
  evaluation: 'postAggregate' | 'preAggregate';
  /** Dimensions that must be conformed for this metric to be splittable across sources. */
  requiresConformed?: string[];
}

export type MetricDef = BaseMetric | DerivedMetric;

export interface DimensionDef {
  id: string;
  labelKey: string;
  keyType: 'string' | 'date' | 'enum' | 'reference';
  reference?: {
    resourceType:
      | 'store'
      | 'channel'
      | 'product'
      | 'category'
      | 'customer-group'
      | 'business-unit'
      | 'discount-code';
  };
  /** Conformed => legal to use as a cross-source join key. */
  conformed: boolean;
  /**
   * Every source must declare an IDENTICAL string here for the dimension to be joinable.
   * The gateway compares them literally. This is what stops GA4's traffic channel being
   * silently joined to a commercetools distribution channel.
   */
  canonicalKeyDefinition?: string;
  cardinalityHint: 'low' | 'medium' | 'high' | 'unbounded';
  /** True for dimensions that can carry personal data and may need redaction. */
  pii?: boolean;
}
