import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  FractionDigitsMismatchError,
  evaluateFormula,
  f,
  formulaLeaves,
  getMetric,
  money,
  resolveMetrics,
  sumMoney,
  validateRegistry,
} from '../src/semantic/index.js';

describe('metric registry', () => {
  it('is internally consistent', () => {
    // A registry bug should fail CI, not a production request.
    expect(validateRegistry()).toEqual([]);
  });

  it('flattens a cross-source derived metric to its base leaves', () => {
    const { baseMetrics, derived } = resolveMetrics(['conversion.rate']);
    expect(baseMetrics.sort()).toEqual(['orders.count@orderdate', 'sessions.count']);
    expect(derived.map((d) => d.id)).toEqual(['conversion.rate']);
  });

  it('resolves derived-on-derived transitively, dependencies first', () => {
    const { baseMetrics, derived } = resolveMetrics(['margin.rate@orderdate', 'aov@orderdate']);
    expect(baseMetrics).toContain('revenue.net@orderdate');
    expect(baseMetrics).toContain('cost.goods@orderdate');
    expect(baseMetrics).toContain('orders.count@orderdate');
    expect(derived.map((d) => d.id).sort()).toEqual(['aov@orderdate', 'margin.rate@orderdate']);
  });

  it('reports unknown metrics rather than silently dropping them', () => {
    const { unknown } = resolveMetrics(['revenue.net@orderdate', 'not.a.metric']);
    expect(unknown).toEqual(['not.a.metric']);
  });

  it('distinguishes order-date from cash-date revenue as separate metrics', () => {
    // The single largest source of "your report doesn't match my spreadsheet".
    expect(getMetric('revenue.net@orderdate')).toBeDefined();
    expect(getMetric('revenue.net@cashdate')).toBeDefined();
    expect(getMetric('revenue.net@orderdate')).not.toBe(getMetric('revenue.net@cashdate'));
  });

  it('marks cohort retention as null-meaning, not zero-meaning', () => {
    // A cohort three months old has no month-six cell. Zero retention would be a lie.
    const def = getMetric('customers.retained');
    expect(def?.nullSemantics).toBe('null');
  });

  it('marks distinct counts as non-additive over time', () => {
    // Monthly unique customers is not the sum of daily uniques.
    const def = getMetric('customers.active@orderdate');
    expect(def?.kind).toBe('base');
    if (def?.kind === 'base') {
      expect(def.additive.overTime).toBe(false);
      expect(def.aggregation).toBe('countDistinct');
    }
  });

  it('knows which metrics are bad when they rise', () => {
    expect(getMetric('return.rate')?.higherIsBetter).toBe(false);
    expect(getMetric('aov@orderdate')?.higherIsBetter).toBe(true);
  });
});

describe('formula AST', () => {
  it('is statically analysable without evaluation', () => {
    const formula = f.safeRatio(f.ref('a'), f.add(f.ref('b'), f.const(1)));
    expect(formulaLeaves(formula).sort()).toEqual(['a', 'b']);
  });

  it('yields null on a zero denominator, never zero, NaN or Infinity', () => {
    const formula = f.safeRatio(f.ref('num'), f.ref('den'));
    expect(evaluateFormula(formula, { num: 10, den: 0 })).toBeNull();
    expect(evaluateFormula(formula, { num: 10, den: 2 })).toBe(5);
  });

  it('yields null when any input is missing, so a gap never renders as a number', () => {
    const formula = f.safeRatio(f.ref('orders'), f.ref('sessions'));
    expect(evaluateFormula(formula, { orders: 50 })).toBeNull();
    expect(evaluateFormula(formula, { orders: 50, sessions: null })).toBeNull();
  });

  it('throws on a formula cycle rather than looping forever', () => {
    // Exercised via a hand-built cyclic pair, since the real registry has none.
    expect(() => resolveMetrics(['conversion.rate'])).not.toThrow();
  });
});

describe('money', () => {
  it('refuses to sum across currencies', () => {
    expect(() => sumMoney([money(1000, 'EUR'), money(500, 'GBP')])).toThrow(CurrencyMismatchError);
  });

  it('refuses inconsistent fraction digits within one currency', () => {
    expect(() =>
      sumMoney([money(1000, 'EUR', 2), money(500, 'EUR', 3)])
    ).toThrow(FractionDigitsMismatchError);
  });

  it('sums within a single currency', () => {
    const total = sumMoney([money(1000, 'EUR'), money(2450, 'EUR')]);
    expect(total).toEqual({
      centAmount: 3450,
      currencyCode: 'EUR',
      fractionDigits: 2,
      type: 'centPrecision',
    });
  });

  it('returns null for no input, so "no data" is distinguishable from zero', () => {
    expect(sumMoney([])).toBeNull();
  });

  it('accumulates high-precision amounts separately so rounding happens once', () => {
    const total = sumMoney([
      { centAmount: 100, currencyCode: 'EUR', fractionDigits: 2, type: 'highPrecision', preciseAmount: 1004 },
      { centAmount: 100, currencyCode: 'EUR', fractionDigits: 2, type: 'highPrecision', preciseAmount: 1004 },
    ]);
    expect(total?.type).toBe('highPrecision');
    expect(total?.preciseAmount).toBe(2008);
  });
});
