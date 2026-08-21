import { useCallback, useMemo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  decodeFilters,
  encodeFilters,
  type FilterState,
} from './filters-codec';
import type { CatalogueEntry } from '../../types/reporting';

/**
 * Filter state, held in the URL.
 *
 * `history.replace` for ordinary control changes and `history.push` for navigation, so the
 * browser back button undoes a drill-down without walking back through every slider nudge.
 */
export const useReportFilters = (report: CatalogueEntry | undefined) => {
  const location = useLocation();
  const history = useHistory();

  const filters = useMemo(
    () =>
      report
        ? decodeFilters(location.search, report)
        : ({
            datePreset: 'last28d',
            grain: 'day',
            compare: 'previousPeriod',
            dimensions: {},
          } as FilterState),
    [location.search, report]
  );

  const setFilters = useCallback(
    (next: FilterState, options?: { push?: boolean }) => {
      const search = `?${encodeFilters(next).toString()}`;
      if (options?.push) history.push({ pathname: location.pathname, search });
      else history.replace({ pathname: location.pathname, search });
    },
    [history, location.pathname]
  );

  const patch = useCallback(
    (partial: Partial<FilterState>) => setFilters({ ...filters, ...partial }),
    [filters, setFilters]
  );

  /** The shareable link for the current view. */
  const shareableUrl = useMemo(
    () =>
      `${window.location.origin}${location.pathname}?${encodeFilters(
        filters
      ).toString()}`,
    [filters, location.pathname]
  );

  return { filters, setFilters, patch, shareableUrl };
};
