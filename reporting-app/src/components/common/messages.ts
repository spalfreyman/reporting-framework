import { defineMessages } from 'react-intl';

export default defineMessages({
  viewAsTable: {
    id: 'Reporting.common.viewAsTable',
    defaultMessage: 'View as table',
  },
  viewAsChart: {
    id: 'Reporting.common.viewAsChart',
    defaultMessage: 'View as chart',
  },
  noData: {
    id: 'Reporting.common.noData',
    defaultMessage: 'No data for this period',
  },
  tileUnavailable: {
    id: 'Reporting.common.tileUnavailable',
    defaultMessage: 'Not available',
  },
  dataAsOf: {
    id: 'Reporting.common.dataAsOf',
    defaultMessage: 'Data as of {timestamp}',
  },
  demoData: {
    id: 'Reporting.common.demoData',
    defaultMessage: 'Demo data',
  },
  partialData: {
    id: 'Reporting.common.partialData',
    defaultMessage: 'Partial data',
  },
  estimated: {
    id: 'Reporting.common.estimated',
    defaultMessage: 'Estimated',
  },
  comparedTo: {
    id: 'Reporting.common.comparedTo',
    defaultMessage: 'vs {from} – {to}',
  },
  servedBy: {
    id: 'Reporting.common.servedBy',
    defaultMessage: 'Source: {sources}',
  },
  copyLink: {
    id: 'Reporting.common.copyLink',
    defaultMessage: 'Copy link',
  },
  linkCopied: {
    id: 'Reporting.common.linkCopied',
    defaultMessage:
      'Link copied. Filters are included, so the view is shareable.',
  },
  exportCsv: {
    id: 'Reporting.common.exportCsv',
    defaultMessage: 'Export CSV',
  },
  refresh: {
    id: 'Reporting.common.refresh',
    defaultMessage: 'Refresh',
  },
  gatewayNotConfigured: {
    id: 'Reporting.common.gatewayNotConfigured',
    defaultMessage:
      'The reporting gateway has not published its address yet. Deploy the reporting connector, or set REPORTING_GATEWAY_URL for local development.',
  },
});
