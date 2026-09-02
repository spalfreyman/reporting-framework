import type { DataSourceDescriptor } from '../schema/descriptor.js';
import { getDimension } from '../semantic/dimensions.js';
import { coarsestGrain } from '../semantic/types.js';
import type { Grain } from '../semantic/types.js';

/**
 * Join safety.
 *
 * Only conformed dimensions whose canonicalKeyDefinition matches ACROSS EVERY
 * participating source may be joined. GA4's traffic channel and commercetools'
 * distribution channel are different concepts; joining them silently is the classic
 * silent-wrongness bug in this class of tool, so we refuse rather than guess.
 */

export interface JoinPlan {
  /** Dimensions safe to join on, including the time bucket when there is one. */
  joinKey: string[];
  /** The grain every participating source can actually serve. */
  effectiveGrain: Grain | null;
  /** Requested dimensions that cannot be part of a cross-source join. */
  unjoinable: Array<{ dimension: string; reason: string }>;
  /** Blocking problems: the query cannot be planned as requested. */
  blockers: string[];
}

export const planJoin = (
  requestedDimensions: string[],
  requestedGrain: Grain | null,
  sources: DataSourceDescriptor[]
): JoinPlan => {
  const unjoinable: JoinPlan['unjoinable'] = [];
  const blockers: string[] = [];
  const multiSource = sources.length > 1;

  // ── Timezone conformance ──────────────────────────────────────────────────────
  // commercetools is UTC; a GA4 property cuts days in its own timezone. At day grain or
  // coarser those buckets do not line up. Unhandled this produces numbers that are
  // quietly wrong at day boundaries, which is worse than an error.
  const timezones = [...new Set(sources.map((s) => s.capabilities.timezone))];
  if (multiSource && timezones.length > 1 && requestedGrain && requestedGrain !== 'hour') {
    const allOfferHour = sources.every((s) => s.capabilities.grains.includes('hour'));
    if (!allOfferHour) {
      blockers.push(
        `Sources disagree on timezone (${timezones.join(', ')}) and not all can serve hourly ` +
          `data, so ${requestedGrain} buckets cannot be aligned. Refusing to join rather than ` +
          `produce figures that are wrong at day boundaries.`
      );
    }
  }

  // ── Grain ────────────────────────────────────────────────────────────────────
  let effectiveGrain: Grain | null = requestedGrain;
  if (requestedGrain) {
    const servable = sources.map((source) => {
      if (source.capabilities.grains.includes(requestedGrain)) return requestedGrain;
      // Roll-UP from a finer native grain is legal. Roll-DOWN never is.
      const finer = source.capabilities.grains.filter((g) => !isCoarserThan(g, requestedGrain));
      return finer.length > 0 ? requestedGrain : coarsestGrain(source.capabilities.grains);
    });
    effectiveGrain = coarsestGrain(servable);
  }

  // ── Dimension conformance ────────────────────────────────────────────────────
  const joinKey: string[] = [];
  if (effectiveGrain) joinKey.push('date');

  for (const dimensionId of requestedDimensions) {
    if (dimensionId === 'date') continue;
    const def = getDimension(dimensionId);
    if (!def) {
      blockers.push(`Unknown dimension "${dimensionId}"`);
      continue;
    }

    if (!multiSource) {
      joinKey.push(dimensionId);
      continue;
    }

    if (!def.conformed) {
      unjoinable.push({
        dimension: dimensionId,
        reason: `"${dimensionId}" is not a conformed dimension, so it cannot be a cross-source join key`,
      });
      continue;
    }

    const declared = sources.map((source) => ({
      sourceId: source.sourceId,
      key: source.capabilities.dimensions.find((d) => d.dimensionId === dimensionId)
        ?.canonicalKeyDefinition,
    }));

    const missing = declared.filter((d) => !d.key);
    if (missing.length > 0) {
      unjoinable.push({
        dimension: dimensionId,
        reason:
          `${missing.map((m) => m.sourceId).join(', ')} do not declare a canonical key for ` +
          `"${dimensionId}"`,
      });
      continue;
    }

    const distinct = [...new Set(declared.map((d) => d.key))];
    if (distinct.length > 1) {
      unjoinable.push({
        dimension: dimensionId,
        reason:
          `canonical key mismatch for "${dimensionId}": ` +
          declared.map((d) => `${d.sourceId}=${d.key}`).join(' vs '),
      });
      continue;
    }

    if (distinct[0] !== def.canonicalKeyDefinition) {
      unjoinable.push({
        dimension: dimensionId,
        reason:
          `sources declare "${distinct[0]}" for "${dimensionId}" but the registry expects ` +
          `"${def.canonicalKeyDefinition}"`,
      });
      continue;
    }

    joinKey.push(dimensionId);
  }

  return { joinKey, effectiveGrain, unjoinable, blockers };
};

const GRAIN_RANK: Record<Grain, number> = {
  hour: 0,
  day: 1,
  week: 2,
  month: 3,
  quarter: 4,
  year: 5,
};
const isCoarserThan = (a: Grain, b: Grain): boolean => GRAIN_RANK[a] > GRAIN_RANK[b];
