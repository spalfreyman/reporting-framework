import { useIntl } from 'react-intl';
import Constraints from '@commercetools-uikit/constraints';
import SelectInput from '@commercetools-uikit/select-input';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import { labelForDimension } from '../common/format-metric';
import commonMessages from '../common/messages';
import messages from './messages';
import type { FilterState } from '../../hooks/use-report-filters';
import type { CatalogueEntry } from '../../types/reporting';
import type { Grain } from '../../shared/semantic/types';

type Props = {
  report: CatalogueEntry;
  filters: FilterState;
  onChange: (partial: Partial<FilterState>) => void;
  shareableUrl: string;
  onRefresh: () => void;
};

/**
 * The filter bar.
 *
 * Every control writes to the URL rather than to component state, so the view is always
 * shareable. "Copy link" is a first-class control for the same reason — a trading report
 * that cannot be sent to a colleague does not get used.
 */
const FilterBar = ({
  report,
  filters,
  onChange,
  shareableUrl,
  onRefresh,
}: Props) => {
  const intl = useIntl();

  const presets = [
    { value: 'today', label: intl.formatMessage(messages.presetToday) },
    { value: 'yesterday', label: intl.formatMessage(messages.presetYesterday) },
    { value: 'last7d', label: intl.formatMessage(messages.presetLast7d) },
    { value: 'last28d', label: intl.formatMessage(messages.presetLast28d) },
    { value: 'last90d', label: intl.formatMessage(messages.presetLast90d) },
    { value: 'wtd', label: intl.formatMessage(messages.presetWtd) },
    { value: 'mtd', label: intl.formatMessage(messages.presetMtd) },
    { value: 'qtd', label: intl.formatMessage(messages.presetQtd) },
    { value: 'ytd', label: intl.formatMessage(messages.presetYtd) },
  ];

  const grains: Array<{ value: Grain; label: string }> = [
    { value: 'day', label: intl.formatMessage(messages.grainDay) },
    { value: 'week', label: intl.formatMessage(messages.grainWeek) },
    { value: 'month', label: intl.formatMessage(messages.grainMonth) },
    { value: 'quarter', label: intl.formatMessage(messages.grainQuarter) },
    { value: 'year', label: intl.formatMessage(messages.grainYear) },
  ];

  const comparisons = [
    {
      value: 'previousPeriod',
      label: intl.formatMessage(messages.comparePreviousPeriod),
    },
    {
      value: 'previousYear',
      label: intl.formatMessage(messages.comparePreviousYear),
    },
    { value: 'none', label: intl.formatMessage(messages.compareNone) },
  ];

  return (
    <Spacings.Inline scale="m" alignItems="flex-end">
      <Spacings.Stack scale="xs">
        <Text.Detail tone="secondary">
          {intl.formatMessage(messages.dateRange)}
        </Text.Detail>
        <Constraints.Horizontal max={4}>
          <SelectInput
            name="datePreset"
            value={filters.datePreset}
            options={presets}
            onChange={(event) =>
              onChange({ datePreset: event.target.value as string })
            }
          />
        </Constraints.Horizontal>
      </Spacings.Stack>

      <Spacings.Stack scale="xs">
        <Text.Detail tone="secondary">
          {intl.formatMessage(messages.grain)}
        </Text.Detail>
        <Constraints.Horizontal max={3}>
          <SelectInput
            name="grain"
            value={filters.grain}
            options={grains}
            onChange={(event) =>
              onChange({ grain: event.target.value as Grain })
            }
          />
        </Constraints.Horizontal>
      </Spacings.Stack>

      <Spacings.Stack scale="xs">
        <Text.Detail tone="secondary">
          {intl.formatMessage(messages.comparison)}
        </Text.Detail>
        <Constraints.Horizontal max={4}>
          <SelectInput
            name="compare"
            value={filters.compare}
            options={comparisons}
            onChange={(event) =>
              onChange({
                compare: event.target.value as FilterState['compare'],
              })
            }
          />
        </Constraints.Horizontal>
      </Spacings.Stack>

      {report.allowedFilters.map((declared) => (
        <Spacings.Stack key={declared.dimension} scale="xs">
          <Text.Detail tone="secondary">
            {labelForDimension(intl, declared.dimension)}
          </Text.Detail>
          <Constraints.Horizontal max={4}>
            <SelectInput
              name={`d.${declared.dimension}`}
              isMulti={declared.multi}
              isClearable
              value={
                filters.dimensions[declared.dimension] ??
                (declared.multi ? [] : null)
              }
              /**
               * Values come from the gateway's dimension-values endpoint in the full build.
               * Until then the control accepts whatever is already in the URL, so a shared
               * link with a filter still round-trips rather than silently dropping it.
               */
              options={(filters.dimensions[declared.dimension] ?? []).map(
                (value) => ({
                  value,
                  label: value,
                })
              )}
              onChange={(event) => {
                const raw = event.target.value;
                const values = Array.isArray(raw)
                  ? raw.map(String)
                  : raw
                  ? [String(raw)]
                  : [];
                onChange({
                  dimensions: {
                    ...filters.dimensions,
                    [declared.dimension]: values,
                  },
                });
              }}
            />
          </Constraints.Horizontal>
        </Spacings.Stack>
      ))}

      <SecondaryButton
        label={intl.formatMessage(commonMessages.refresh)}
        onClick={onRefresh}
      />
      <SecondaryButton
        label={intl.formatMessage(commonMessages.copyLink)}
        onClick={() => void navigator.clipboard?.writeText(shareableUrl)}
      />
    </Spacings.Inline>
  );
};
FilterBar.displayName = 'FilterBar';

export default FilterBar;
