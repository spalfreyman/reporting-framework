import { formulaLeaves } from './formula.js';
import { getMetric, METRICS } from './metrics.js';
import type { MetricDef } from './types.js';

export interface ResolvedMetrics {
  /** Base metric ids that must actually be fetched from sources. */
  baseMetrics: string[];
  /** Derived metrics to evaluate after the merge, in dependency order. */
  derived: Array<{ id: string; def: Extract<MetricDef, { kind: 'derived' }> }>;
  /** Requested ids that are not in the registry at all. */
  unknown: string[];
}

/**
 * Flattens a requested metric list into the base metrics to fetch plus the derived
 * metrics to evaluate afterwards. Handles derived-on-derived by resolving transitively.
 *
 * Throws on a formula cycle rather than looping — a cycle is a registry bug and should
 * fail loudly at startup, not hang a request.
 */
export const resolveMetrics = (requested: string[]): ResolvedMetrics => {
  const baseMetrics = new Set<string>();
  const derivedById = new Map<string, Extract<MetricDef, { kind: 'derived' }>>();
  const unknown: string[] = [];
  const visiting = new Set<string>();

  const visit = (id: string, trail: string[]): void => {
    if (visiting.has(id)) {
      throw new Error(`Metric formula cycle: ${[...trail, id].join(' -> ')}`);
    }
    const def = getMetric(id);
    if (!def) {
      unknown.push(id);
      return;
    }
    if (def.kind === 'base') {
      baseMetrics.add(id);
      return;
    }
    visiting.add(id);
    for (const leaf of formulaLeaves(def.formula)) visit(leaf, [...trail, id]);
    visiting.delete(id);
    // Insert after its dependencies so evaluation order is dependency order.
    derivedById.set(id, def);
  };

  for (const id of requested) visit(id, []);

  return {
    baseMetrics: [...baseMetrics],
    derived: [...derivedById.entries()].map(([id, def]) => ({ id, def })),
    unknown: [...new Set(unknown)],
  };
};

/**
 * Validates the whole registry. Run this as a test so a bad registry edit fails CI
 * rather than a production request.
 */
export const validateRegistry = (): string[] => {
  const problems: string[] = [];
  for (const [id, def] of Object.entries(METRICS)) {
    if (def.id !== id) problems.push(`${id}: registry key does not match def.id (${def.id})`);
    if (def.kind !== 'derived') continue;

    for (const leaf of formulaLeaves(def.formula)) {
      if (!getMetric(leaf)) {
        problems.push(`${id}: formula references unknown metric "${leaf}"`);
      }
    }
    try {
      resolveMetrics([id]);
    } catch (error) {
      problems.push(`${id}: ${(error as Error).message}`);
    }
  }
  return problems;
};
