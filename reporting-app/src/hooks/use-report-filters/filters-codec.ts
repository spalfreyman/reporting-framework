import type { Filter } from '../../shared/schema/query';
import type { Grain } from '../../shared/semantic/types';
import type { CatalogueEntry } from '../../types/reporting';

/**
 * Filter state lives in the URL.
 *
 * This matters more than it sounds: a trading report that cannot be shared as a link does
 * not get used. Putting the whole filter state in the query string makes every view
 * bookmarkable, shareable and back-button-able for free.
 *
 * Relative date presets are stored as the PRESET ID, not as resolved dates, so a shared
 * link still means "last 28 days" tomorrow. An explicit custom range stores its dates.
 */

export type FilterState = {
  datePreset: string;
  from?: string;
  to?: string;
  grain: Grain;
  compare: 'previousPeriod' | 'previousYear' | 'none';
  /** dimension -> selected values */
  dimensions: Record<string, string[]>;
};

const GRAINS: Grain[] = ['hour', 'day', 'week', 'month', 'quarter', 'year'];
const COMPARISONS: FilterState['compare'][] = [
  'previousPeriod',
  'previousYear',
  'none',
];

export const defaultFilterState = (report: CatalogueEntry): FilterState => ({
  datePreset: report.defaults.datePreset,
  grain: report.defaults.grain,
  compare: report.defaults.comparison.kind,
  dimensions: {},
});

export const encodeFilters = (state: FilterState): URLSearchParams => {
  const params = new URLSearchParams();
  params.set('preset', state.datePreset);
  if (state.datePreset === 'custom' && state.from && state.to) {
    params.set('from', state.from);
    params.set('to', state.to);
  }
  params.set('grain', state.grain);
  params.set('compare', state.compare);
  for (const [dimension, values] of Object.entries(state.dimensions)) {
    if (values.length > 0) params.set(`d.${dimension}`, values.join(','));
  }
  return params;
};

/**
 * Decodes, validating against what the report actually allows.
 *
 * Never throws: a hand-edited or stale URL falls back to the report's defaults rather than
 * showing an error page. A shared link that has outlived a report change should still open.
 */
export const decodeFilters = (
  search: string,
  report: CatalogueEntry
): FilterState => {
  const params = new URLSearchParams(search);
  const fallback = defaultFilterState(report);

  const preset = params.get('preset');
  const allowedPresets = new Set([
    'today',
    'yesterday',
    'last7d',
    'last28d',
    'last90d',
    'wtd',
    'mtd',
    'qtd',
    'ytd',
    'custom',
  ]);
  const datePreset =
    preset && allowedPresets.has(preset) ? preset : fallback.datePreset;

  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const isValidDay = (value?: string) =>
    Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

  const grainParam = params.get('grain') as Grain | null;
  const grain =
    grainParam && GRAINS.includes(grainParam) ? grainParam : fallback.grain;

  const compareParam = params.get('compare') as FilterState['compare'] | null;
  const compare =
    compareParam && COMPARISONS.includes(compareParam)
      ? compareParam
      : fallback.compare;

  // Only dimensions the report declares as filterable are honoured, so a crafted URL cannot
  // introduce a filter the report never offered.
  const allowedDimensions = new Set(
    report.allowedFilters.map((f) => f.dimension)
  );
  const dimensions: Record<string, string[]> = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith('d.')) continue;
    const dimension = key.slice(2);
    if (!allowedDimensions.has(dimension)) continue;
    const values = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 0) dimensions[dimension] = values;
  }

  return {
    datePreset,
    ...(datePreset === 'custom' && isValidDay(from) && isValidDay(to)
      ? { from, to }
      : {}),
    grain,
    compare,
    dimensions,
  };
};

/** Turns filter state into the request body the gateway expects. */
export const toRequest = (
  state: FilterState,
  timezone: string,
  locale: string
): {
  datePreset: string;
  range?: { from: string; to: string };
  grain: Grain;
  compare: FilterState['compare'];
  filters: Filter[];
  timezone: string;
  locale: string;
} => ({
  datePreset: state.datePreset,
  ...(state.datePreset === 'custom' && state.from && state.to
    ? { range: { from: state.from, to: state.to } }
    : {}),
  grain: state.grain,
  compare: state.compare,
  filters: Object.entries(state.dimensions).map(([dimension, values]) => ({
    dimension,
    op: 'in' as const,
    values,
  })),
  timezone,
  locale,
});
