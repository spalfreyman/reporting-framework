import type { RowScope } from '../schema/query';
import { getMetric } from '../semantic/metrics';

/**
 * Role and capability framing.
 *
 * Enforced SERVER-SIDE in the gateway from the verified exchange JWT. The UI mirrors it
 * for usability only — hiding a metric in the client would be security theatre.
 *
 * Three layers:
 *   1. Report visibility   — does this subject see the report at all?
 *   2. Field visibility    — which metrics/dimensions within it?
 *   3. Row-level scope     — which rows? (see the v1 note on ScopeAssignment)
 */

/** A capability string: 'metric:<id>' | 'dim:<id>' | 'report:<id>' | 'source:<id>'. */
export type Capability = string;

export interface Subject {
  /** Stable subject id from the verified JWT, when the token carries one. */
  id: string | null;
  /** `can<PermissionName>` claims, e.g. canViewOrders. From the JWT ONLY. */
  permissions: string[];
  projectKey: string;
  locale: string;
}

export interface AccessPolicy {
  key: string;
  priority: number;
  match: {
    anyPermission?: string[];
    allPermissions?: string[];
    anySubjectTag?: string[];
  };
  grant: { capabilities: Capability[]; sources?: string[] };
  deny?: { capabilities: Capability[] };
  rowScope?: { dimension: keyof RowScope; from: 'assignment' | 'literal'; values?: string[] };
  redact?: Array<{ dimension: string; mode: 'hash' | 'mask' | 'drop' }>;
  /** k-anonymity: suppress cells below this count so small groups can't be de-anonymised. */
  minAggregation?: { dimension: string; kMin: number };
}

/**
 * Row-level scope assignment.
 *
 * v1 CAVEAT: this keys off `Subject.id`, which depends on the exchange JWT carrying a
 * stable identity. Until that is confirmed, the gateway ships with report-level gating
 * (layers 1 and 2) and treats every subject as unrestricted unless an assignment exists.
 * The seam is built now because retrofitting scope into the planner later is expensive.
 */
export interface ScopeAssignment {
  subjectId: string;
  scope: RowScope;
  tags?: string[];
}

export interface EffectiveAccess {
  subject: Subject;
  allowedReports: Set<string> | 'all';
  deniedReports: Set<string>;
  metrics: Set<string> | 'all';
  dimensions: Set<string> | 'all';
  sources: Set<string> | 'all';
  /**
   * Deny sets are kept SEPARATELY from the grant sets. A wildcard grant ('metric:*')
   * collapses `metrics` to 'all', so without these a deny would be silently overridden -
   * which would leak financial metrics to anyone with base reporting access.
   */
  deniedMetrics: Set<string>;
  deniedDimensions: Set<string>;
  /** Sensitivity groups this subject has been granted, e.g. 'financials'. */
  sensitivities: Set<string>;
  /**
   * Metrics named outright in a grant, as opposed to covered by a wildcard. Needed because
   * `metrics` collapses to 'all' under a wildcard, which would otherwise lose the
   * distinction that sensitivity checks depend on.
   */
  explicitMetrics: Set<string>;
  rowScope: RowScope;
  redactions: Map<string, 'hash' | 'mask' | 'drop'>;
  minAggregation: Map<string, number>;
  unrestricted: boolean;
  /** Goes into the cache key. Omit it and one subject's cached tile leaks to another. */
  hash: string;
}

const matches = (policy: AccessPolicy, subject: Subject, tags: string[]): boolean => {
  const { anyPermission, allPermissions, anySubjectTag } = policy.match;
  if (anyPermission && !anyPermission.some((p) => subject.permissions.includes(p))) return false;
  if (allPermissions && !allPermissions.every((p) => subject.permissions.includes(p))) return false;
  if (anySubjectTag && !anySubjectTag.some((t) => tags.includes(t))) return false;
  return true;
};

const parseCapability = (capability: Capability): { kind: string; id: string } => {
  const index = capability.indexOf(':');
  if (index === -1) return { kind: 'report', id: capability };
  return { kind: capability.slice(0, index), id: capability.slice(index + 1) };
};

/** Intersects two row scopes. Most restrictive wins; empty intersection means NO data. */
const intersectScope = (a: RowScope, b: RowScope): RowScope => {
  const field = (
    key: 'stores' | 'businessUnits' | 'channels' | 'countries'
  ): string[] | undefined => {
    const left = a[key];
    const right = b[key];
    if (!left) return right;
    if (!right) return left;
    return left.filter((v) => right.includes(v));
  };
  return {
    stores: field('stores'),
    businessUnits: field('businessUnits'),
    channels: field('channels'),
    countries: field('countries'),
    unrestricted: false,
  };
};

const stableHash = (value: unknown): string => {
  // Small, dependency-free FNV-1a over canonical JSON. Not cryptographic — it only needs
  // to be stable and collision-resistant enough for a cache key.
  const canonical = JSON.stringify(value, (_k, v) =>
    v instanceof Set ? [...v].sort() : v instanceof Map ? [...v.entries()].sort() : v
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const resolveAccess = (
  subject: Subject,
  policies: AccessPolicy[],
  assignment: ScopeAssignment | null
): EffectiveAccess => {
  const tags = assignment?.tags ?? [];
  const applicable = policies
    .filter((p) => matches(p, subject, tags))
    .sort((a, b) => a.priority - b.priority);

  const grantedMetrics = new Set<string>();
  const grantedDimensions = new Set<string>();
  const grantedSources = new Set<string>();
  const grantedReports = new Set<string>();
  const deniedMetrics = new Set<string>();
  const deniedDimensions = new Set<string>();
  const deniedReports = new Set<string>();
  const redactions = new Map<string, 'hash' | 'mask' | 'drop'>();
  const minAggregation = new Map<string, number>();
  const sensitivities = new Set<string>();

  let rowScope: RowScope = { unrestricted: true };
  let sawScopePolicy = false;
  let wildcardMetrics = false;
  let wildcardDimensions = false;
  let wildcardSources = false;
  let wildcardReports = false;

  for (const policy of applicable) {
    for (const capability of policy.grant.capabilities) {
      const { kind, id } = parseCapability(capability);
      if (kind === 'metric') id === '*' ? (wildcardMetrics = true) : grantedMetrics.add(id);
      else if (kind === 'dim') id === '*' ? (wildcardDimensions = true) : grantedDimensions.add(id);
      else if (kind === 'source') id === '*' ? (wildcardSources = true) : grantedSources.add(id);
      else if (kind === 'sensitivity') sensitivities.add(id);
      else if (kind === 'report') id === '*' ? (wildcardReports = true) : grantedReports.add(id);
    }
    for (const sourceId of policy.grant.sources ?? []) grantedSources.add(sourceId);

    for (const capability of policy.deny?.capabilities ?? []) {
      const { kind, id } = parseCapability(capability);
      if (kind === 'metric') deniedMetrics.add(id);
      else if (kind === 'dim') deniedDimensions.add(id);
      else if (kind === 'report') deniedReports.add(id);
    }

    for (const r of policy.redact ?? []) redactions.set(r.dimension, r.mode);
    if (policy.minAggregation) {
      minAggregation.set(policy.minAggregation.dimension, policy.minAggregation.kMin);
    }

    if (policy.rowScope) {
      sawScopePolicy = true;
      const values =
        policy.rowScope.from === 'literal'
          ? (policy.rowScope.values ?? [])
          : (assignment?.scope[policy.rowScope.dimension] as string[] | undefined) ?? [];
      // FAIL CLOSED: a scope-bearing policy with no assignment yields no data, not all data.
      const restriction: RowScope = { unrestricted: false, [policy.rowScope.dimension]: values };
      rowScope = rowScope.unrestricted ? restriction : intersectScope(rowScope, restriction);
    }
  }

  // Deny always wins over grant. Removing from the grant sets is not sufficient on its
  // own, because a wildcard grant bypasses them entirely - hence the deny sets below.
  for (const id of deniedMetrics) grantedMetrics.delete(id);
  for (const id of deniedDimensions) grantedDimensions.delete(id);
  for (const id of deniedReports) grantedReports.delete(id);

  const access: Omit<EffectiveAccess, 'hash'> = {
    subject,
    allowedReports: wildcardReports ? 'all' : grantedReports,
    deniedReports,
    metrics: wildcardMetrics ? 'all' : grantedMetrics,
    dimensions: wildcardDimensions ? 'all' : grantedDimensions,
    sources: wildcardSources ? 'all' : grantedSources,
    deniedMetrics,
    deniedDimensions,
    sensitivities,
    explicitMetrics: new Set(grantedMetrics),
    rowScope,
    redactions,
    minAggregation,
    unrestricted: !sawScopePolicy && rowScope.unrestricted,
  };

  return {
    ...access,
    hash: stableHash({
      metrics: access.metrics,
      dimensions: access.dimensions,
      deniedMetrics: access.deniedMetrics,
      deniedDimensions: access.deniedDimensions,
      sensitivities: access.sensitivities,
      sources: access.sources,
      reports: access.allowedReports,
      denied: access.deniedReports,
      scope: access.rowScope,
      redactions: access.redactions,
      minAggregation: access.minAggregation,
    }),
  };
};

export const canSeeMetric = (access: EffectiveAccess, metricId: string): boolean => {
  // An explicit deny is absolute — it cannot be granted back by a later policy.
  if (access.deniedMetrics.has(metricId)) return false;

  // A sensitive metric is never covered by a wildcard grant. It needs either its
  // sensitivity group granted or the metric named outright, so 'metric:*' is safe to
  // hand out to every reporting viewer.
  const def = getMetric(metricId);
  if (def?.sensitivity) {
    return access.sensitivities.has(def.sensitivity) || access.explicitMetrics.has(metricId);
  }

  return access.metrics === 'all' || access.metrics.has(metricId);
};

export const canSeeDimension = (access: EffectiveAccess, dimensionId: string): boolean => {
  if (access.deniedDimensions.has(dimensionId)) return false;
  return access.dimensions === 'all' || access.dimensions.has(dimensionId);
};

export const canUseSource = (access: EffectiveAccess, sourceId: string): boolean =>
  access.sources === 'all' || access.sources.has(sourceId);

export const canSeeReport = (access: EffectiveAccess, reportId: string): boolean => {
  if (access.deniedReports.has(reportId)) return false;
  return access.allowedReports === 'all' || access.allowedReports.has(reportId);
};

/** Scope dimensions actually in force, which sources must be able to enforce themselves. */
export const activeScopeDimensions = (scope: RowScope): string[] => {
  if (scope.unrestricted) return [];
  const out: string[] = [];
  if (scope.stores) out.push('store');
  if (scope.businessUnits) out.push('businessUnit');
  if (scope.channels) out.push('distributionChannel');
  if (scope.countries) out.push('country');
  return out;
};

/**
 * Filters a requested metric list down to what the subject may see, splitting out an
 * explicit denial so a client bug surfaces as a 403 rather than a quietly wrong dashboard.
 */
export const partitionRequestedMetrics = (
  access: EffectiveAccess,
  requested: string[]
): { allowed: string[]; denied: string[]; unknown: string[] } => {
  const allowed: string[] = [];
  const denied: string[] = [];
  const unknown: string[] = [];
  for (const id of requested) {
    if (!getMetric(id)) unknown.push(id);
    else if (canSeeMetric(access, id)) allowed.push(id);
    else denied.push(id);
  }
  return { allowed, denied, unknown };
};

/**
 * The default policy set, shipped so the framework works out of the box.
 * Financial metrics sit behind a `financials` group so a merchandiser sees revenue and
 * units but not margin or cost.
 */
export const DEFAULT_POLICIES: AccessPolicy[] = [
  {
    key: 'base-viewer',
    priority: 100,
    match: { anyPermission: ['canViewReporting'] },
    // The wildcards are safe: metrics tagged with a `sensitivity` group in the registry
    // are excluded from wildcard coverage and need the group granted explicitly.
    grant: { capabilities: ['report:*', 'metric:*', 'dim:*', 'source:*'] },
  },
  {
    key: 'financials',
    priority: 200,
    match: { anyPermission: ['canViewReportingFinancials', 'canManageReporting'] },
    grant: { capabilities: ['sensitivity:financials'] },
  },
];
