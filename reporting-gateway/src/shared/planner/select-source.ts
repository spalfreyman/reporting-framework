import type { DataSourceDescriptor, MetricCapability } from '../schema/descriptor.js';
import type { DateRange } from '../schema/query.js';
import type { Grain } from '../semantic/types.js';
import { addDays, parseDay } from '../util/date-range.js';

/**
 * Source selection.
 *
 * A deterministic ranked comparator: identical requests MUST produce identical plans, or
 * both caching and support break. The final tiebreak is lexicographic sourceId precisely
 * so there is never a coin-flip.
 */

export interface SelectionContext {
  metrics: string[];
  dimensions: string[];
  grain: Grain | null;
  range: DateRange;
  /** Today, in the report timezone. Used to resolve relative date floors/ceilings. */
  today: string;
  /** Report-level cap on acceptable staleness. */
  maxAcceptableLagSeconds?: number;
  /** Explicit pins, highest priority. */
  preferredSource?: string;
  /** Customer overrides from reporting.config/source-priority. */
  sourcePriority?: Record<string, string[]>;
  /** Scope dimensions that must be enforceable by the source (fail closed). */
  requiredScopeDimensions?: string[];
  /** Live quota headroom per source, 0..1, from each source's /health. */
  quotaHeadroom?: Record<string, number>;
}

export interface Candidate {
  source: DataSourceDescriptor;
  capability: MetricCapability;
  coversFullRange: boolean;
  needsRollUp: boolean;
}

export interface Rejection {
  sourceId: string;
  reason: string;
}

export interface MetricAssignment {
  metric: string;
  sourceId: string | null;
  rule: string;
  rejected: Rejection[];
}

/** Resolves an absolute date or a relative ISO-8601-ish duration ('-P90D') to a day. */
const resolveBoundary = (value: string | undefined, today: string): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^-?P(\d+)D$/);
  if (match) return addDays(today, -Number(match[1]));
  return null;
};

const GRAIN_RANK: Record<Grain, number> = {
  hour: 0,
  day: 1,
  week: 2,
  month: 3,
  quarter: 4,
  year: 5,
};

const COST_RANK = { cheap: 0, moderate: 1, expensive: 2 } as const;
const EXACTNESS_RANK = { exact: 0, sampled: 1, estimated: 2 } as const;

/** Candidates for a single metric, with the reason each rejected source was excluded. */
export const candidatesFor = (
  metric: string,
  sources: DataSourceDescriptor[],
  ctx: SelectionContext
): { candidates: Candidate[]; rejected: Rejection[] } => {
  const candidates: Candidate[] = [];
  const rejected: Rejection[] = [];

  for (const source of sources) {
    const capability = source.capabilities.metrics.find((m) => m.metricId === metric);
    if (!capability) {
      rejected.push({ sourceId: source.sourceId, reason: `does not serve ${metric}` });
      continue;
    }

    // Fail closed on scope: a source that cannot enforce the scope dimension itself must
    // not be used for a scoped subject. You cannot post-filter aggregates you can't split.
    const missingScope = (ctx.requiredScopeDimensions ?? []).filter(
      (d) => !source.scoping.rowLevelDimensions.includes(d)
    );
    if (missingScope.length > 0) {
      rejected.push({
        sourceId: source.sourceId,
        reason: `cannot enforce row-level scope on ${missingScope.join(', ')}`,
      });
      continue;
    }

    const missingDimensions = ctx.dimensions.filter(
      (d) => d !== 'date' && !capability.dimensions.includes(d)
    );
    if (missingDimensions.length > 0) {
      rejected.push({
        sourceId: source.sourceId,
        reason: `cannot split ${metric} by ${missingDimensions.join(', ')}`,
      });
      continue;
    }

    let needsRollUp = false;
    if (ctx.grain) {
      if (!capability.grains.includes(ctx.grain)) {
        // Roll-UP from a finer native grain is legal; roll-DOWN never is.
        const finer = capability.grains.filter((g) => GRAIN_RANK[g] < GRAIN_RANK[ctx.grain!]);
        if (finer.length === 0) {
          rejected.push({
            sourceId: source.sourceId,
            reason: `serves ${capability.grains.join('/')} — cannot roll down to ${ctx.grain}`,
          });
          continue;
        }
        needsRollUp = true;
      }
    }

    const floor = resolveBoundary(capability.dateFloor ?? source.capabilities.dateFloor, ctx.today);
    const ceiling = resolveBoundary(source.capabilities.dateCeiling, ctx.today);
    const coversFrom = !floor || parseDay(ctx.range.from) >= parseDay(floor);
    const coversTo = !ceiling || parseDay(ctx.range.to) <= parseDay(ceiling);

    if (!coversFrom && floor && parseDay(ctx.range.to) <= parseDay(floor)) {
      rejected.push({
        sourceId: source.sourceId,
        reason: `entire range predates its floor of ${floor}`,
      });
      continue;
    }

    if (
      ctx.maxAcceptableLagSeconds !== undefined &&
      source.freshness.maxLagSeconds > ctx.maxAcceptableLagSeconds
    ) {
      rejected.push({
        sourceId: source.sourceId,
        reason: `max lag ${source.freshness.maxLagSeconds}s exceeds the report's ${ctx.maxAcceptableLagSeconds}s`,
      });
      continue;
    }

    candidates.push({
      source,
      capability,
      coversFullRange: coversFrom && coversTo,
      needsRollUp,
    });
  }

  return { candidates, rejected };
};

const compareCandidates =
  (ctx: SelectionContext, metric: string) =>
  (a: Candidate, b: Candidate): number => {
    // 1. Customer priority override, then 2. full range coverage.
    const priority = ctx.sourcePriority?.[metric];
    if (priority) {
      const rank = (c: Candidate) => {
        const i = priority.indexOf(c.source.sourceId);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
    }

    if (a.coversFullRange !== b.coversFullRange) return a.coversFullRange ? -1 : 1;

    // 3. Exactness: an exact figure beats a sampled or modelled one.
    const exactness = EXACTNESS_RANK[a.capability.exactness] - EXACTNESS_RANK[b.capability.exactness];
    if (exactness !== 0) return exactness;

    // 4. System of record.
    if (a.source.provenance.systemOfRecord !== b.source.provenance.systemOfRecord) {
      return a.source.provenance.systemOfRecord ? -1 : 1;
    }

    // 5. Native grain fit beats needing a roll-up.
    if (a.needsRollUp !== b.needsRollUp) return a.needsRollUp ? 1 : -1;

    // 6. Freshness.
    const lag = a.source.freshness.typicalLagSeconds - b.source.freshness.typicalLagSeconds;
    if (lag !== 0) return lag;

    // 7. Cost class, then live quota headroom.
    const cost = COST_RANK[a.capability.costClass] - COST_RANK[b.capability.costClass];
    if (cost !== 0) return cost;

    const headroom =
      (ctx.quotaHeadroom?.[b.source.sourceId] ?? 1) - (ctx.quotaHeadroom?.[a.source.sourceId] ?? 1);
    if (headroom !== 0) return headroom;

    // 8. Authority rank, then lexicographic id so the result is never a coin-flip.
    const authority = b.source.provenance.authorityRank - a.source.provenance.authorityRank;
    if (authority !== 0) return authority;

    return a.source.sourceId.localeCompare(b.source.sourceId);
  };

/**
 * Assigns every metric to a source.
 *
 * The SET-COVER PASS runs first: a single source that can serve every metric in the tile
 * at the requested split beats any multi-source plan, because cross-source joins are lossy
 * and avoiding one is worth more than any per-metric optimum.
 */
export const selectSources = (
  sources: DataSourceDescriptor[],
  ctx: SelectionContext
): { assignments: MetricAssignment[]; singleSource: string | null } => {
  const perMetric = new Map<string, { candidates: Candidate[]; rejected: Rejection[] }>();
  for (const metric of ctx.metrics) {
    perMetric.set(metric, candidatesFor(metric, sources, ctx));
  }

  // ── Set-cover pass ──────────────────────────────────────────────────────────
  const coveringSources = sources
    .filter((source) =>
      ctx.metrics.every((metric) =>
        perMetric.get(metric)!.candidates.some((c) => c.source.sourceId === source.sourceId)
      )
    )
    .sort((a, b) => {
      // Among sources that cover everything, prefer the pinned one, then apply the same
      // comparator using the first metric as a representative.
      if (ctx.preferredSource === a.sourceId) return -1;
      if (ctx.preferredSource === b.sourceId) return 1;
      const first = ctx.metrics[0];
      const ca = perMetric.get(first)!.candidates.find((c) => c.source.sourceId === a.sourceId)!;
      const cb = perMetric.get(first)!.candidates.find((c) => c.source.sourceId === b.sourceId)!;
      return compareCandidates(ctx, first)(ca, cb);
    });

  if (coveringSources.length > 0) {
    const chosen = coveringSources[0];
    return {
      singleSource: chosen.sourceId,
      assignments: ctx.metrics.map((metric) => ({
        metric,
        sourceId: chosen.sourceId,
        rule: ctx.preferredSource === chosen.sourceId ? 'pinned' : 'set-cover',
        rejected: perMetric
          .get(metric)!
          .rejected.concat(
            perMetric
              .get(metric)!
              .candidates.filter((c) => c.source.sourceId !== chosen.sourceId)
              .map((c) => ({
                sourceId: c.source.sourceId,
                reason: 'another source covered every metric in this tile',
              }))
          ),
      })),
    };
  }

  // ── Per-metric fallback ─────────────────────────────────────────────────────
  const assignments = ctx.metrics.map((metric) => {
    const { candidates, rejected } = perMetric.get(metric)!;
    if (candidates.length === 0) {
      return { metric, sourceId: null, rule: 'no-capable-source', rejected };
    }
    if (ctx.preferredSource) {
      const pinned = candidates.find((c) => c.source.sourceId === ctx.preferredSource);
      if (pinned) {
        return {
          metric,
          sourceId: pinned.source.sourceId,
          rule: 'pinned',
          rejected: rejected.concat(
            candidates
              .filter((c) => c !== pinned)
              .map((c) => ({ sourceId: c.source.sourceId, reason: 'a source was pinned' }))
          ),
        };
      }
    }
    const ranked = [...candidates].sort(compareCandidates(ctx, metric));
    const winner = ranked[0];
    return {
      metric,
      sourceId: winner.source.sourceId,
      rule: 'comparator',
      rejected: rejected.concat(
        ranked.slice(1).map((c) => ({
          sourceId: c.source.sourceId,
          reason: 'lost the selection comparator',
        }))
      ),
    };
  });

  return { assignments, singleSource: null };
};
