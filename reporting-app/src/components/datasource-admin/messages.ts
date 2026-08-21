import { defineMessages } from 'react-intl';

export default defineMessages({
  title: { id: 'Reporting.sources.title', defaultMessage: 'Data sources' },
  subtitle: {
    id: 'Reporting.sources.subtitle',
    defaultMessage:
      'Each installed connector publishes what it can serve. Installing one extends the framework with no redeploy of this application.',
  },
  none: {
    id: 'Reporting.sources.none',
    defaultMessage:
      'No data sources are installed. Deploy a data-source connector — for example the commercetools native source — and it will appear here within a minute.',
  },
  columnSource: {
    id: 'Reporting.sources.columnSource',
    defaultMessage: 'Source',
  },
  columnKind: { id: 'Reporting.sources.columnKind', defaultMessage: 'Kind' },
  columnMetrics: {
    id: 'Reporting.sources.columnMetrics',
    defaultMessage: 'Metrics',
  },
  columnFreshness: {
    id: 'Reporting.sources.columnFreshness',
    defaultMessage: 'Freshness',
  },
  columnTimezone: {
    id: 'Reporting.sources.columnTimezone',
    defaultMessage: 'Timezone',
  },
  columnScoping: {
    id: 'Reporting.sources.columnScoping',
    defaultMessage: 'Row scoping',
  },
  demo: { id: 'Reporting.sources.demo', defaultMessage: 'Demo' },
  invalidDescriptors: {
    id: 'Reporting.sources.invalidDescriptors',
    defaultMessage:
      '{count} registered descriptor(s) could not be read and are being ignored: {keys}',
  },
  loadedAt: {
    id: 'Reporting.sources.loadedAt',
    defaultMessage: 'Registry read {timestamp}',
  },
  lagSeconds: {
    id: 'Reporting.sources.lagSeconds',
    defaultMessage: '{mode}, ~{seconds}s behind',
  },
  noScoping: { id: 'Reporting.sources.noScoping', defaultMessage: 'None' },
});
