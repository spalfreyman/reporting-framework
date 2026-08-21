import { defineMessages } from 'react-intl';

export default defineMessages({
  dateRange: { id: 'Reporting.viewer.dateRange', defaultMessage: 'Period' },
  grain: { id: 'Reporting.viewer.grain', defaultMessage: 'Granularity' },
  comparison: {
    id: 'Reporting.viewer.comparison',
    defaultMessage: 'Compare to',
  },
  backToCatalogue: {
    id: 'Reporting.viewer.backToCatalogue',
    defaultMessage: 'Back to report catalogue',
  },
  presetToday: { id: 'Reporting.preset.today', defaultMessage: 'Today' },
  presetYesterday: {
    id: 'Reporting.preset.yesterday',
    defaultMessage: 'Yesterday',
  },
  presetLast7d: {
    id: 'Reporting.preset.last7d',
    defaultMessage: 'Last 7 days',
  },
  presetLast28d: {
    id: 'Reporting.preset.last28d',
    defaultMessage: 'Last 28 days',
  },
  presetLast90d: {
    id: 'Reporting.preset.last90d',
    defaultMessage: 'Last 90 days',
  },
  presetWtd: { id: 'Reporting.preset.wtd', defaultMessage: 'Week to date' },
  presetMtd: { id: 'Reporting.preset.mtd', defaultMessage: 'Month to date' },
  presetQtd: { id: 'Reporting.preset.qtd', defaultMessage: 'Quarter to date' },
  presetYtd: { id: 'Reporting.preset.ytd', defaultMessage: 'Year to date' },
  grainDay: { id: 'Reporting.grain.day', defaultMessage: 'Daily' },
  grainWeek: { id: 'Reporting.grain.week', defaultMessage: 'Weekly' },
  grainMonth: { id: 'Reporting.grain.month', defaultMessage: 'Monthly' },
  grainQuarter: { id: 'Reporting.grain.quarter', defaultMessage: 'Quarterly' },
  grainYear: { id: 'Reporting.grain.year', defaultMessage: 'Yearly' },
  comparePreviousPeriod: {
    id: 'Reporting.compare.previousPeriod',
    defaultMessage: 'Previous period',
  },
  comparePreviousYear: {
    id: 'Reporting.compare.previousYear',
    defaultMessage: 'Previous year',
  },
  compareNone: {
    id: 'Reporting.compare.none',
    defaultMessage: 'No comparison',
  },
  showingRange: {
    id: 'Reporting.viewer.showingRange',
    defaultMessage: '{from} to {to}, {grain}',
  },
  reportFailed: {
    id: 'Reporting.viewer.reportFailed',
    defaultMessage: 'This report could not be run. See the notices below.',
  },
  reportPartial: {
    id: 'Reporting.viewer.reportPartial',
    defaultMessage:
      'Some tiles are incomplete. Each one explains what is missing rather than guessing.',
  },
});
