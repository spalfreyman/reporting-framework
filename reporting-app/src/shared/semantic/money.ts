/**
 * Money handling. Never a bare number.
 *
 * The load-bearing rule: `currency` is an IMPLICIT MANDATORY DIMENSION of every money
 * metric. The planner injects it into the group-by, which makes "you cannot sum across
 * currencies" true by construction rather than by code review.
 */

export interface Money {
  centAmount: number;
  currencyCode: string;
  fractionDigits: number;
  type: 'centPrecision' | 'highPrecision';
  /** Scale-20 integer, present only when type is highPrecision. */
  preciseAmount?: number;
}

export const money = (
  centAmount: number,
  currencyCode: string,
  fractionDigits = 2
): Money => ({ centAmount, currencyCode, fractionDigits, type: 'centPrecision' });

export class CurrencyMismatchError extends Error {
  constructor(readonly currencies: string[]) {
    super(
      `Refusing to sum across currencies (${currencies.join(', ')}). ` +
        `Group by currency, or configure an FX policy on the report.`
    );
    this.name = 'CurrencyMismatchError';
  }
}

export class FractionDigitsMismatchError extends Error {
  constructor(readonly currencyCode: string, readonly seen: number[]) {
    super(
      `Currency ${currencyCode} arrived with inconsistent fractionDigits (${seen.join(', ')}). ` +
        `This is a data-integrity problem, not something to coerce silently.`
    );
    this.name = 'FractionDigitsMismatchError';
  }
}

/**
 * Sums money values, refusing to combine different currencies.
 * Returns null for an empty input so callers can distinguish "no data" from "zero".
 */
export const sumMoney = (values: Money[]): Money | null => {
  if (values.length === 0) return null;

  const currencies = [...new Set(values.map((v) => v.currencyCode))];
  if (currencies.length > 1) throw new CurrencyMismatchError(currencies.sort());

  const fractionDigits = [...new Set(values.map((v) => v.fractionDigits))];
  if (fractionDigits.length > 1) {
    throw new FractionDigitsMismatchError(currencies[0], fractionDigits.sort());
  }

  const isHighPrecision = values.some((v) => v.type === 'highPrecision');
  const centAmount = values.reduce((total, v) => total + v.centAmount, 0);

  if (!isHighPrecision) {
    return {
      centAmount,
      currencyCode: currencies[0],
      fractionDigits: fractionDigits[0],
      type: 'centPrecision',
    };
  }

  // Accumulate precise amounts separately so display rounds exactly once, at the end.
  const preciseAmount = values.reduce(
    (total, v) => total + (v.preciseAmount ?? v.centAmount),
    0
  );
  return {
    centAmount,
    currencyCode: currencies[0],
    fractionDigits: fractionDigits[0],
    type: 'highPrecision',
    preciseAmount,
  };
};

/** Minor units to a display number. Formatting itself belongs to the UI's Intl layer. */
export const toDecimal = (value: Money): number =>
  value.centAmount / 10 ** value.fractionDigits;
