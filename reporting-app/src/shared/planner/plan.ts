import type { DataSourceDescriptor } from '../schema/descriptor';
import type { DateRange, Filter, RowScope } from '../schema/query';
import type { ReportDefinition, Tile } from '../schema/report-definition';
import { getDimension } from '../semantic/dimensions';
import { formulaLeaves } from '../semantic/formula';
import { isMoneyMetric } from '../semantic/metrics';
import { resolveMetrics } from '../semantic/resolve';
import type { DerivedMetric, Grain } from '../semantic/types';
import { stableHash } from '../util/hash';
import {
  activeScopeDimensions,
  canSeeDimension,
  canSeeMetric,
  canUseSource,
  type EffectiveAccess,
} from '../framing/access';
import { planJoin } from './conformance';
import { selectSources, type MetricAssignment } from './select-source';

/**
 * Compiles a report definition plus user filters plus the subject's access frame into a
 * concrete execution plan.
 */

export interface PlanContext {
  projectKey: string;
  today: string;
  timezone: string;
  weekStart: 'monday' | 'sunday';
  range: DateRange;
  compareTo?: DateRange;
  grain: Grain;
  filters: Filter[];
  access: EffectiveAccess;
  sources: DataSourceDescriptor[];
  sourcePriority?: Record<string, string[]>;
  quotaHeadroom?: Record<string, number>;
}

export interface SubQuery {
  sourceId: string;
  metrics: string[];
  dimensions: string[];
  grain: Grain | null;
  filters: Filter[];
  /** Injected server-side. A source must intersect this; it can narrow, never widen. */
  scope: RowScope;
  pointInTime: boolean;
}

export interface PlanNotice {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface TilePlan {
  tileId: string;
  subQueries: SubQuery[];
  joinKey: string[];
  effectiveGrain: Grain | null;
  baseMetrics: string[];
  derived: Array<{ id: string; def: DerivedMetric }>;
  /** Metrics that cannot be served at all — the tile renders them as unavailable. */
  unavailableMetrics: Array<{ metric: string; reason: string }>;
  assignments: MetricAssignment[];
  sourceSelectionHash: string;
  notices: PlanNotice[];
  renderable: boolean;
}

export interface ReportPlan {
  reportId: string;
  reportVersion: number;
  tiles: TilePlan[];
  notices: PlanNotice[];
  scopeHash: string;
}

/** Money metrics force `currency` into the group-by unless an FX policy says otherwise. */
const injectCurrencyDimension = (
  metrics: string[],
  dimensions: string[],
  fxMode: 'none' | 'reportCurrency'
): { dimensions: string[]; injected: boolean } => {
  const hasMoney = metrics.some(isMoneyMetric);
  if (!hasMoney || fxMode === 'reportCurrency' || dimensions.includes('currency')) {
    return { dimensions, injected: false };
  }
  return { dimensions: [...dimensions, 'currency'], injected: true };
};

export const planTile = (
  tile: Tile,
  report: ReportDefinition,
  ctx: PlanContext
): TilePlan => {
  const notices: PlanNotice[] = [];

  // ── Access: prune what the subject may not see ─────────────────────────────
  const requested = tile.query.metrics;
  const permitted = requested.filter((id) => canSeeMetric(ctx.access, id));
  const deniedMetrics = requested.filter((id) => !permitted.includes(id));
  if (deniedMetrics.length > 0) {
    notices.push({
      severity: 'info',
      code: 'METRICS_HIDDEN',
      message: `Hidden by permissions: ${deniedMetrics.join(', ')}`,
    });
  }

  const { baseMetrics, derived, unknown } = resolveMetrics(permitted);
  if (unknown.length > 0) {
    notices.push({
      severity: 'error',
      code: 'UNKNOWN_METRIC',
      message: `Not in the metric registry: ${unknown.join(', ')}`,
    });
  }

  // ── Dimensions ────────────────────────────────────────────────────────────
  const grain = tile.query.grain === 'inherit' ? ctx.grain : tile.query.grain;
  const effectivePointInTime = tile.query.pointInTime;
  const { dimensions: withCurrency, injected } = injectCurrencyDimension(
    permitted,
    tile.query.dimensions,
    report.defaults.fx.mode
  );
  if (injected) {
    notices.push({
      severity: 'info',
      code: 'CURRENCY_INJECTED',
      message:
        'Grouped by currency automatically: money metrics cannot be summed across currencies ' +
        'without an FX policy.',
    });
  }
  const dimensions = withCurrency.filter((id) => {
    if (!getDimension(id)) {
      notices.push({
        severity: 'error',
        code: 'UNKNOWN_DIMENSION',
        message: `Not in the dimension registry: ${id}`,
      });
      return false;
    }
    if (!canSeeDimension(ctx.access, id)) {
      notices.push({
        severity: 'info',
        code: 'DIMENSION_HIDDEN',
        message: `Hidden by permissions: ${id}`,
      });
      return false;
    }
    return true;
  });

  // ── Source selection ──────────────────────────────────────────────────────
  const scopeDimensions = activeScopeDimensions(ctx.access.rowScope);
  const usableSources = ctx.sources.filter((s) => canUseSource(ctx.access, s.sourceId));

  const { assignments } = selectSources(usableSources, {
    metrics: baseMetrics,
    dimensions,
    grain: effectivePointInTime ? null : grain,
    range: ctx.range,
    today: ctx.today,
    maxAcceptableLagSeconds: report.freshness.maxAcceptableLagSeconds,
    preferredSource: tile.query.preferredSource,
    sourcePriority: ctx.sourcePriority,
    requiredScopeDimensions: scopeDimensions,
    quotaHeadroom: ctx.quotaHeadroom,
  });

  const unavailableMetrics = assignments
    .filter((a) => a.sourceId === null)
    .map((a) => ({
      metric: a.metric,
      reason:
        a.rejected.length > 0
          ? a.rejected.map((r) => `${r.sourceId}: ${r.reason}`).join('; ')
          : 'no installed data source serves this metric',
    }));

  const unavailableBase = new Set(unavailableMetrics.map((u) => u.metric));

  // A derived metric whose leaf cannot be served is UNAVAILABLE, not zero and not a guess.
  // It has to be listed alongside the missing base metrics, or a tile whose only displayed
  // value is that derived metric would report itself healthy while rendering a null.
  for (const { id, def } of derived) {
    const missing = formulaLeaves(def.formula).filter((leaf) => unavailableBase.has(leaf));
    if (missing.length === 0) continue;
    unavailableMetrics.push({
      metric: id,
      reason: `needs ${missing.join(', ')}, which no installed data source serves`,
    });
    notices.push({
      severity: 'warning',
      code: 'NO_SOURCE_FOR_LEAF',
      message: `${id} is unavailable: it needs ${missing.join(', ')}, which no source serves.`,
    });
  }

  const chosenSourceIds = [...new Set(assignments.map((a) => a.sourceId).filter(Boolean))] as string[];
  const chosenSources = usableSources.filter((s) => chosenSourceIds.includes(s.sourceId));

  // ── Join safety ───────────────────────────────────────────────────────────
  const join = planJoin(dimensions, effectivePointInTime ? null : grain, chosenSources);
  for (const blocker of join.blockers) {
    notices.push({ severity: 'error', code: 'JOIN_BLOCKED', message: blocker });
  }
  for (const { dimension, reason } of join.unjoinable) {
    notices.push({
      severity: 'error',
      code: 'DIMENSION_NOT_CONFORMED',
      message: `Cannot break down across sources by ${dimension} — ${reason}.`,
    });
  }

  if (join.effectiveGrain && !effectivePointInTime && join.effectiveGrain !== grain) {
    const handling = tile.query.onGrainMismatch;
    notices.push({
      severity: 'warning',
      code: 'GRAIN_COARSENED',
      message:
        `Shown at ${join.effectiveGrain} grain, not ${grain}: not every contributing source can ` +
        `serve ${grain}. (No interpolation is performed.)`,
    });
    if (handling === 'omit') {
      notices.push({
        severity: 'info',
        code: 'GRAIN_OMIT',
        message: 'Metrics that cannot serve the requested grain are omitted from this tile.',
      });
    }
  }

  // ── Sub-queries, one per chosen source ────────────────────────────────────
  const filters = [...ctx.filters, ...tile.query.filters];
  const subQueries: SubQuery[] = chosenSourceIds.map((sourceId) => ({
    sourceId,
    metrics: assignments.filter((a) => a.sourceId === sourceId).map((a) => a.metric),
    dimensions,
    grain: effectivePointInTime ? null : (join.effectiveGrain ?? grain),
    filters,
    scope: ctx.access.rowScope,
    pointInTime: effectivePointInTime,
  }));

  // A tile is renderable only if at least one metric it actually DISPLAYS can be served.
  // Checking `subQueries.length > 0` alone is not enough: a tile showing only a derived
  // metric still produces a subquery for its available leaf, and would look healthy while
  // displaying nothing but nulls.
  const unavailable = new Set(unavailableMetrics.map((u) => u.metric));
  const displayable = permitted.filter((id) => !unavailable.has(id));
  const blocking = notices.some((n) => n.severity === 'error');
  const renderable =
    subQueries.length > 0 &&
    displayable.length > 0 &&
    (report.failurePolicy === 'lenient' ? !blocking : !blocking && unavailableMetrics.length === 0);

  return {
    tileId: tile.id,
    subQueries,
    joinKey: join.joinKey,
    effectiveGrain: effectivePointInTime ? null : (join.effectiveGrain ?? grain),
    baseMetrics: assignments.filter((a) => a.sourceId !== null).map((a) => a.metric),
    derived,
    unavailableMetrics,
    assignments,
    sourceSelectionHash: stableHash(assignments.map((a) => [a.metric, a.sourceId])),
    notices,
    renderable,
  };
};

export const planReport = (report: ReportDefinition, ctx: PlanContext): ReportPlan => {
  const tiles = report.tiles.map((tile) => planTile(tile, report, ctx));
  const notices: PlanNotice[] = [];

  const missingRequired = report.requiredCapabilities.metrics.filter((metric) =>
    tiles.some((t) => t.unavailableMetrics.some((u) => u.metric === metric))
  );
  if (missingRequired.length > 0) {
    notices.push({
      severity: 'error',
      code: 'MISSING_REQUIRED_METRIC',
      message:
        `This report requires ${missingRequired.join(', ')}, which no installed data source ` +
        `provides. Install a suitable connector to enable it.`,
    });
  }

  return {
    reportId: report.id,
    reportVersion: report.version,
    tiles,
    notices,
    scopeHash: ctx.access.hash,
  };
};

/**
 * Report availability for the catalogue.
 *
 * A report blocked by a MISSING CONNECTOR is surfaced as unavailable-with-a-reason, so the
 * UI can say "install a web analytics source to enable this". A report blocked by
 * PERMISSIONS is omitted entirely, because report titles can themselves be sensitive.
 */
export type Availability =
  | { state: 'available' }
  | { state: 'unavailable'; reason: string; missingMetrics: string[] }
  | { state: 'hidden' };

export const reportAvailability = (
  report: ReportDefinition,
  access: EffectiveAccess,
  sources: DataSourceDescriptor[]
): Availability => {
  if (access.deniedReports.has(report.id)) return { state: 'hidden' };
  if (access.allowedReports !== 'all' && !access.allowedReports.has(report.id)) {
    return { state: 'hidden' };
  }
  for (const permission of report.requiredCapabilities.permissions) {
    if (!access.subject.permissions.includes(permission)) return { state: 'hidden' };
  }

  const usable = sources.filter((s) => canUseSource(access, s.sourceId));
  const served = new Set(usable.flatMap((s) => s.capabilities.metrics.map((m) => m.metricId)));

  const missingMetrics = report.requiredCapabilities.metrics.filter((metric) => {
    const { baseMetrics } = resolveMetrics([metric]);
    return !baseMetrics.every((leaf) => served.has(leaf));
  });

  if (missingMetrics.length > 0) {
    const kinds = report.requiredCapabilities.sourceKinds;
    return {
      state: 'unavailable',
      missingMetrics,
      reason: kinds.length > 0
        ? `Needs a ${kinds.join(' or ')} data source. Install a suitable connector to enable this report.`
        : `No installed data source provides ${missingMetrics.join(', ')}.`,
    };
  }
  return { state: 'available' };
};
