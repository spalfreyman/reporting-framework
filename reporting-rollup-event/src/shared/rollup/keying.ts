import { factContainer, orderFactsContainer } from '../schema/descriptor.js';

/**
 * Rollup keying and the cardinality guard.
 *
 * The design decision that makes the Custom Object tier viable: ONE OBJECT PER
 * (date, cube, shard) holding a rows array, NOT one object per fact row. "Last 28 days"
 * then becomes 28 point reads by key - no predicate scan, no offset, no reliance on
 * value-field index performance.
 *
 * The difference is three orders of magnitude in object count on identical data.
 */

export const FACT_KEY_VERSION = 'v1';

/** Day partition key: v1_d2026-08-19, sharded as v1_d2026-08-19_p1, _p2, ... */
export const dayPartitionKey = (day: string, shard = 0): string =>
  shard === 0 ? `${FACT_KEY_VERSION}_d${day}` : `${FACT_KEY_VERSION}_d${day}_p${shard}`;

export const parseDayPartitionKey = (
  key: string
): { day: string; shard: number } | null => {
  const match = key.match(/^v1_d(\d{4}-\d{2}-\d{2})(?:_p(\d+))?$/);
  if (!match) return null;
  return { day: match[1], shard: match[2] ? Number(match[2]) : 0 };
};

export const cubeContainer = (cube: string): string => factContainer(cube);

/** Order facts are sharded by month so the fold job's scan set stays bounded. */
export const orderFactContainerFor = (businessDate: string): string =>
  orderFactsContainer(businessDate.slice(0, 7));

// ── Document shapes ──────────────────────────────────────────────────────────────

export interface FactCell<M extends Record<string, number | null> = Record<string, number | null>> {
  /** Fine dimension values for this cell, e.g. { currency: 'EUR', store: 'de-berlin-01' }. */
  k: Record<string, string>;
  /** Measures. */
  m: M;
}

export interface DayPartition {
  schemaVersion: 1;
  cube: string;
  grain: 'day';
  date: string;
  /** IANA timezone the day boundary was cut in. Wrong value here is silently wrong data. */
  timezone: string;
  shard: number;
  shards: number;
  meta: {
    builtAt: string;
    materializationId: string;
    /** Newest event included. Becomes the tile's "data as of". */
    watermark: string;
    restatementEpoch: number;
    /** Orders that fed this partition, for the reconcile job's drift check. */
    sourceOrderCount: number;
    rowCount: number;
    contentHash: string;
  };
  rows: FactCell[];
}

export interface OrderFact {
  schemaVersion: 1;
  orderId: string;
  /** Monotonic guard: only write when incoming > stored. Makes redelivery a no-op. */
  orderVersion: number;
  lastSequenceNumber: number;
  /** The order date, in the reporting timezone. Drives which partition is dirtied. */
  businessDate: string;
  /** Dates money actually moved - refunds and captures bucket here, not on businessDate. */
  cashDates: string[];
  dims: Record<string, string>;
  measures: Record<string, number>;
  items?: Array<{
    sku: string;
    category: string;
    units: number;
    revenueNet: number;
    returnsUnits: number;
  }>;
  sourceLastModifiedAt: string;
  updatedAt: string;
}

export interface JobLock {
  owner: string;
  runId: string;
  acquiredAt: string;
  heartbeatAt: string;
  /** Must exceed the 30-minute job timeout so a crashed run's lock expires. */
  expiresAt: string;
}

export interface JobCursor {
  phase: 'fold' | 'reconcile' | 'backfill' | 'compact';
  /** Keyset cursor. NEVER an offset - the platform caps offset at 10,000. */
  lastModifiedAt: string;
  lastId: string;
  window?: { from: string; to: string };
  progress: { processed: number };
  epoch: number;
  updatedAt: string;
}

// ── The cardinality guard ────────────────────────────────────────────────────────

/**
 * Custom Object JSON documents cap at 16 MB, but commercetools recommends keeping the
 * average around 100 KB and large documents under 2 MB. We design to a 200 KB ceiling.
 */
export const DESIGN_OBJECT_BYTES = 200_000;
export const BYTES_PER_CELL_ESTIMATE = 200;
export const CELLS_PER_OBJECT = Math.floor(DESIGN_OBJECT_BYTES / BYTES_PER_CELL_ESTIMATE);

/** The project-wide soft limit. Your rollups are a TENANT of this, not its owner. */
export const CUSTOM_OBJECT_SOFT_LIMIT = 20_000_000;
/** Refuse to plan a cube that would consume more than this share of the limit. */
export const TENANT_OBJECT_BUDGET = 2_000_000;

export interface CardinalityEstimate {
  rowsPerDay: number;
  shardsPerDay: number;
  objectsPerYear: number;
  objectsForRetention: number;
  /** What the naive one-object-per-row design would cost, for comparison. */
  naiveObjectsForRetention: number;
  withinBudget: boolean;
  recommendation: 'custom-objects' | 'warehouse';
  /** Blocking: any entry here means the Custom Object tier will not hold. */
  reasons: string[];
  /** Non-blocking operational notes. */
  advisories: string[];
}

/**
 * Pre-flight estimate for a proposed cube.
 *
 * This is the difference between a framework and a footgun: nothing otherwise stops an
 * operator declaring a [date, sku, store, channel] cube and generating millions of rows a
 * day. Surface this in the admin UI and refuse the configuration rather than discovering
 * it in production.
 */
export const estimateCardinality = (
  dimensionCardinalities: Record<string, number>,
  retentionDays: number
): CardinalityEstimate => {
  const rowsPerDay = Object.values(dimensionCardinalities).reduce(
    (product, n) => product * Math.max(1, n),
    1
  );
  const shardsPerDay = Math.max(1, Math.ceil(rowsPerDay / CELLS_PER_OBJECT));
  const objectsPerYear = shardsPerDay * 365;
  const objectsForRetention = shardsPerDay * retentionDays;
  const naiveObjectsForRetention = rowsPerDay * retentionDays;

  const reasons: string[] = [];
  const advisories: string[] = [];
  if (rowsPerDay > 5000) {
    reasons.push(
      `${rowsPerDay.toLocaleString()} rows/day exceeds the ~5,000 the Custom Object tier is ` +
        `designed for (${shardsPerDay} shards per day).`
    );
  }
  if (objectsForRetention > TENANT_OBJECT_BUDGET) {
    reasons.push(
      `${objectsForRetention.toLocaleString()} objects over ${retentionDays} days exceeds the ` +
        `${TENANT_OBJECT_BUDGET.toLocaleString()} tenant budget (project soft limit is ` +
        `${CUSTOM_OBJECT_SOFT_LIMIT.toLocaleString()}, shared with everything else).`
    );
  }
  if (retentionDays > 730) {
    advisories.push(
      'Retention beyond 24 months at day grain should be compacted into month partitions ' +
        'to keep object count flat rather than linear in time.'
    );
  }

  const withinBudget = reasons.length === 0;
  return {
    rowsPerDay,
    shardsPerDay,
    objectsPerYear,
    objectsForRetention,
    naiveObjectsForRetention,
    withinBudget,
    recommendation: withinBudget ? 'custom-objects' : 'warehouse',
    reasons,
    advisories,
  };
};

/**
 * Packs cells into shards under the design ceiling.
 * Deterministic: the same input always produces the same sharding, so a rebuild is a no-op.
 */
export const shardCells = <T extends FactCell>(cells: T[]): T[][] => {
  if (cells.length === 0) return [[]];
  const shards: T[][] = [];
  for (let i = 0; i < cells.length; i += CELLS_PER_OBJECT) {
    shards.push(cells.slice(i, i + CELLS_PER_OBJECT));
  }
  return shards;
};

/**
 * Reduces an item-grain cube to the top N by a measure plus an `__other__` residual.
 * This single trick is what keeps most catalogues on the default tier: top 500 SKUs per
 * store per day is ~10k rows for a 50k-SKU catalogue, instead of 1,000,000.
 */
export const OTHER_BUCKET = '__other__';

export const topNWithResidual = <T extends FactCell>(
  cells: T[],
  byMeasure: string,
  n: number,
  residualKey: Record<string, string>
): FactCell[] => {
  if (cells.length <= n) return cells;
  const sorted = [...cells].sort(
    (a, b) => (b.m[byMeasure] ?? 0) - (a.m[byMeasure] ?? 0)
  );
  const head = sorted.slice(0, n);
  const tail = sorted.slice(n);

  const measureNames = [...new Set(tail.flatMap((c) => Object.keys(c.m)))];
  const residual: FactCell = { k: { ...residualKey }, m: {} };
  for (const measure of measureNames) {
    residual.m[measure] = tail.reduce((total, c) => total + (c.m[measure] ?? 0), 0);
  }
  return [...head, residual];
};
