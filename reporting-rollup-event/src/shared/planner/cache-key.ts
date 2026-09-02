import type { DateRange, Filter } from '../schema/query.js';
import type { Grain } from '../semantic/types.js';
import { stableHash } from '../util/hash.js';
import { splitSealedHot } from '../util/date-range.js';

/**
 * Cache keys.
 *
 * `scopeHash` is MANDATORY and non-negotiable: omit it and a store manager's cached tile
 * leaks to another store. We key on the SCOPE rather than the user id, so users who share
 * a scope also share cache.
 *
 * `restatementEpoch` is in every key, which makes invalidation after a backfill a single
 * Custom Object write rather than a cache sweep.
 */

export interface CacheKeyInput {
  protocolVersion: number;
  projectKey: string;
  reportId: string;
  reportVersion: number;
  tileId: string;
  metrics: string[];
  dimensions: string[];
  grain: Grain | null;
  timezone: string;
  /** Absolute, already-resolved range. Never a preset — 'last28d' means different things. */
  range: DateRange;
  compareTo?: DateRange;
  filters: Filter[];
  scopeHash: string;
  sourceSelectionHash: string;
  fxPolicyHash: string;
  registryVersion: string;
  restatementEpoch: number;
  locale: string;
}

export const cacheKey = (input: CacheKeyInput): string => `rq_${stableHash(input)}`;

export interface TtlDecision {
  ttlSeconds: number;
  /** True when the whole range is sealed and can be cached for a long time. */
  fullySealed: boolean;
  reason: string;
}

/**
 * The sealed/hot split is the biggest caching lever in the framework.
 *
 * Everything before `today - restatementWindowDays` can no longer change, so it gets a
 * long TTL keyed on the restatement epoch. Only the hot tail needs refetching. A 12-month
 * trend chart then costs one small query per refresh instead of re-aggregating a year.
 */
export const decideTtl = (
  range: DateRange,
  today: string,
  restatementWindowDays: number,
  ttlTodaySeconds: number,
  ttlSealedSeconds: number
): TtlDecision => {
  const { hot } = splitSealedHot(range, today, restatementWindowDays);
  if (!hot) {
    return {
      ttlSeconds: ttlSealedSeconds,
      fullySealed: true,
      reason: `range ends before the sealed boundary (today - ${restatementWindowDays}d)`,
    };
  }
  return {
    ttlSeconds: ttlTodaySeconds,
    fullySealed: false,
    reason: 'range includes days that can still be restated',
  };
};
