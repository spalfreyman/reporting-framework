import type { Formula } from './types';

/**
 * Flattens a formula to the set of leaf metric ids it depends on, without executing it.
 * The planner uses this to decide which sources to ask for what.
 */
export const formulaLeaves = (formula: Formula): string[] => {
  const out = new Set<string>();
  const walk = (node: Formula): void => {
    switch (node.op) {
      case 'ref':
        out.add(node.metric);
        return;
      case 'const':
        return;
      case 'safeRatio':
        walk(node.num);
        walk(node.den);
        return;
      default:
        walk(node.left);
        walk(node.right);
    }
  };
  walk(formula);
  return [...out];
};

/**
 * Evaluates a formula against already-aggregated inputs.
 *
 * Returns null — never NaN, Infinity or 0 — when an input is missing or a denominator is
 * zero. A missing input must render as "unavailable", not as a plausible wrong number.
 */
export const evaluateFormula = (
  formula: Formula,
  inputs: Record<string, number | null | undefined>
): number | null => {
  const evaluate = (node: Formula): number | null => {
    switch (node.op) {
      case 'const':
        return node.value;
      case 'ref': {
        const value = inputs[node.metric];
        return value === null || value === undefined || Number.isNaN(value) ? null : value;
      }
      case 'add': {
        const [l, r] = [evaluate(node.left), evaluate(node.right)];
        return l === null || r === null ? null : l + r;
      }
      case 'sub': {
        const [l, r] = [evaluate(node.left), evaluate(node.right)];
        return l === null || r === null ? null : l - r;
      }
      case 'mul': {
        const [l, r] = [evaluate(node.left), evaluate(node.right)];
        return l === null || r === null ? null : l * r;
      }
      case 'safeRatio': {
        const [num, den] = [evaluate(node.num), evaluate(node.den)];
        if (num === null || den === null || den === 0) return null;
        const result = num / den;
        return Number.isFinite(result) ? result : null;
      }
    }
  };
  return evaluate(formula);
};

/** Convenience constructors, so registry entries read declaratively. */
export const f = {
  ref: (metric: string): Formula => ({ op: 'ref', metric }),
  const: (value: number): Formula => ({ op: 'const', value }),
  add: (left: Formula, right: Formula): Formula => ({ op: 'add', left, right }),
  sub: (left: Formula, right: Formula): Formula => ({ op: 'sub', left, right }),
  mul: (left: Formula, right: Formula): Formula => ({ op: 'mul', left, right }),
  safeRatio: (num: Formula, den: Formula): Formula => ({ op: 'safeRatio', num, den }),
};
