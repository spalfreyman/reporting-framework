import type { Grain } from '../semantic/types';
import type { DateRange } from '../schema/query';

/**
 * Date handling for reporting.
 *
 * Two rules that prevent the classic bugs:
 *  - Ranges are HALF-OPEN [from, to). Every off-by-one-day bug comes from inclusive
 *    upper bounds.
 *  - Comparison periods align by WEEKDAY INDEX by default, not literal date, or
 *    week-over-week compares Monday to Sunday.
 *
 * All arithmetic is done on UTC-midnight instants derived from YYYY-MM-DD strings, so it
 * is DST-safe: we never add 24h to a local time.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const parseDay = (day: string): number => {
  if (!ISO_DATE.test(day)) throw new Error(`Expected YYYY-MM-DD, got "${day}"`);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${day}"`);
  return ms;
};

export const formatDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day: string, delta: number): string =>
  formatDay(parseDay(day) + delta * MS_PER_DAY);

/** Number of days in a half-open range. */
export const rangeLengthDays = (range: DateRange): number =>
  Math.round((parseDay(range.to) - parseDay(range.from)) / MS_PER_DAY);

export const eachDay = (range: DateRange): string[] => {
  const out: string[] = [];
  for (let ms = parseDay(range.from); ms < parseDay(range.to); ms += MS_PER_DAY) {
    out.push(formatDay(ms));
  }
  return out;
};

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7d'
  | 'last28d'
  | 'last90d'
  | 'wtd'
  | 'mtd'
  | 'qtd'
  | 'ytd'
  | 'custom';

/**
 * Resolves a preset against a reference day (normally "today" in the report timezone).
 * `today` is passed in rather than read from the clock so this is deterministic and
 * testable, and so the caller owns the timezone decision.
 */
export const resolvePreset = (
  preset: Exclude<DatePreset, 'custom'>,
  today: string,
  weekStart: 'monday' | 'sunday' = 'monday'
): DateRange => {
  const todayMs = parseDay(today);
  const tomorrow = addDays(today, 1);

  switch (preset) {
    case 'today':
      return { from: today, to: tomorrow };
    case 'yesterday':
      return { from: addDays(today, -1), to: today };
    // Trailing windows end at today exclusive, i.e. they exclude the partial current day.
    case 'last7d':
      return { from: addDays(today, -7), to: today };
    case 'last28d':
      return { from: addDays(today, -28), to: today };
    case 'last90d':
      return { from: addDays(today, -90), to: today };
    // To-date windows DO include the partial current day; trailing windows above do not.
    // Both conventions are in use; these are the ones trading teams expect.
    case 'wtd': {
      const dow = new Date(todayMs).getUTCDay(); // 0 = Sunday
      const offset = weekStart === 'monday' ? (dow + 6) % 7 : dow;
      return { from: addDays(today, -offset), to: tomorrow };
    }
    case 'mtd': {
      const d = new Date(todayMs);
      return { from: `${d.toISOString().slice(0, 7)}-01`, to: tomorrow };
    }
    case 'qtd': {
      const d = new Date(todayMs);
      const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
      const month = String(quarterStartMonth + 1).padStart(2, '0');
      return { from: `${d.getUTCFullYear()}-${month}-01`, to: tomorrow };
    }
    case 'ytd':
      return { from: `${new Date(todayMs).getUTCFullYear()}-01-01`, to: tomorrow };
  }
};

/**
 * The comparison range.
 *
 * 'previousPeriod' with alignBy 'weekday' shifts back by a whole number of WEEKS when the
 * range is a multiple of 7 days, so weekday-for-weekday comparison holds. Otherwise it
 * shifts by the range length.
 *
 * 'previousYear' with alignBy 'weekday' shifts back 364 days (52 weeks) rather than 365,
 * which keeps weekdays aligned — the convention retail trading teams actually use.
 */
export const resolveComparison = (
  range: DateRange,
  kind: 'previousPeriod' | 'previousYear' | 'none',
  alignBy: 'weekday' | 'date' = 'weekday'
): DateRange | null => {
  if (kind === 'none') return null;
  const lengthDays = rangeLengthDays(range);

  // 'previousPeriod' is always the immediately preceding window of the same length.
  // For a range that is a multiple of 7 days this preserves weekday alignment for free;
  // for one that is not, there is no shift that both abuts the range and aligns weekdays,
  // and abutting is what traders expect. So alignBy only affects 'previousYear'.
  if (kind === 'previousPeriod') {
    return { from: addDays(range.from, -lengthDays), to: addDays(range.to, -lengthDays) };
  }

  if (alignBy === 'weekday') {
    return { from: addDays(range.from, -364), to: addDays(range.to, -364) };
  }
  const shiftYear = (day: string): string => {
    const [y, m, d] = day.split('-');
    return `${Number(y) - 1}-${m}-${d}`;
  };
  return { from: shiftYear(range.from), to: shiftYear(range.to) };
};

/** Bucket a day into the start of its grain period. Weeks start Monday by default. */
export const bucketDay = (
  day: string,
  grain: Grain,
  weekStart: 'monday' | 'sunday' = 'monday'
): string => {
  const ms = parseDay(day);
  const d = new Date(ms);
  switch (grain) {
    case 'hour':
    case 'day':
      return day;
    case 'week': {
      const dow = d.getUTCDay();
      const offset = weekStart === 'monday' ? (dow + 6) % 7 : dow;
      return addDays(day, -offset);
    }
    case 'month':
      return `${day.slice(0, 7)}-01`;
    case 'quarter': {
      const month = String(Math.floor(d.getUTCMonth() / 3) * 3 + 1).padStart(2, '0');
      return `${d.getUTCFullYear()}-${month}-01`;
    }
    case 'year':
      return `${d.getUTCFullYear()}-01-01`;
  }
};

/**
 * The sealed/hot boundary: the day before which data can no longer be restated.
 * Everything strictly before this can be cached for a long time; only the hot tail needs
 * refetching. This is the single biggest caching lever in the framework.
 */
export const sealedBoundary = (today: string, restatementWindowDays: number): string =>
  addDays(today, -Math.max(0, restatementWindowDays));

export const splitSealedHot = (
  range: DateRange,
  today: string,
  restatementWindowDays: number
): { sealed: DateRange | null; hot: DateRange | null } => {
  const boundary = sealedBoundary(today, restatementWindowDays);
  const boundaryMs = parseDay(boundary);
  const fromMs = parseDay(range.from);
  const toMs = parseDay(range.to);

  if (toMs <= boundaryMs) return { sealed: range, hot: null };
  if (fromMs >= boundaryMs) return { sealed: null, hot: range };
  return {
    sealed: { from: range.from, to: boundary },
    hot: { from: boundary, to: range.to },
  };
};
