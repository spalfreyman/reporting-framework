import { useIntl } from 'react-intl';
import { PageContentFull } from '@commercetools-frontend/application-components';
import DataTable from '@commercetools-uikit/data-table';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import Spacings from '@commercetools-uikit/spacings';
import Stamp from '@commercetools-uikit/stamp';
import Text from '@commercetools-uikit/text';
import { ContentNotification } from '@commercetools-uikit/notifications';
import { useGatewayFetch } from '../../hooks/use-gateway-fetch';
import commonMessages from '../common/messages';
import messages from './messages';
import type {
  DataSourceSummary,
  DataSourcesResponse,
} from '../../types/reporting';

/**
 * The data-source admin page.
 *
 * Its most important job is the timezone-drift warning. commercetools cuts days in UTC, a
 * GA4 property in its own configured timezone, a warehouse in whatever its tables use — and
 * if those disagree, every cross-source day-grain report is subtly wrong at the boundaries.
 * That failure is invisible in the charts, so it has to be loud here.
 */
const DatasourceAdmin = () => {
  const intl = useIntl();
  const { data, loading, error } = useGatewayFetch<DataSourcesResponse>(
    '/gateway/datasources'
  );

  if (loading) return <LoadingSpinner scale="l" />;

  if (error) {
    return (
      <ContentNotification type="error">
        {error.message === 'GATEWAY_NOT_CONFIGURED'
          ? intl.formatMessage(commonMessages.gatewayNotConfigured)
          : error.message}
      </ContentNotification>
    );
  }

  const sources = data?.sources ?? [];

  const columns = [
    { key: 'sourceId', label: intl.formatMessage(messages.columnSource) },
    { key: 'kind', label: intl.formatMessage(messages.columnKind) },
    {
      key: 'metrics',
      label: intl.formatMessage(messages.columnMetrics),
      align: 'right' as const,
    },
    { key: 'freshness', label: intl.formatMessage(messages.columnFreshness) },
    { key: 'timezone', label: intl.formatMessage(messages.columnTimezone) },
    { key: 'scoping', label: intl.formatMessage(messages.columnScoping) },
  ];

  const render = (source: DataSourceSummary, key: string) => {
    switch (key) {
      case 'sourceId':
        return (
          <Spacings.Inline scale="xs" alignItems="center">
            <Text.Body>{source.displayName}</Text.Body>
            <Text.Caption tone="secondary">{`${source.sourceId} v${source.connector.version}`}</Text.Caption>
            {source.demoMode ? (
              <Stamp tone="warning" isCondensed>
                {intl.formatMessage(messages.demo)}
              </Stamp>
            ) : null}
          </Spacings.Inline>
        );
      case 'kind':
        return source.kind;
      case 'metrics':
        return String(source.capabilities.metrics.length);
      case 'freshness':
        return intl.formatMessage(messages.lagSeconds, {
          mode: source.freshness.mode,
          seconds: source.freshness.typicalLagSeconds,
        });
      case 'timezone':
        return source.capabilities.timezone;
      case 'scoping':
        return source.scoping.rowLevelDimensions.length > 0
          ? source.scoping.rowLevelDimensions.join(', ')
          : intl.formatMessage(messages.noScoping);
      default:
        return null;
    }
  };

  return (
    <PageContentFull>
      <Spacings.Stack scale="l">
        <Spacings.Stack scale="xs">
          <Text.Headline as="h1">
            {intl.formatMessage(messages.title)}
          </Text.Headline>
          <Text.Detail tone="secondary">
            {intl.formatMessage(messages.subtitle)}
          </Text.Detail>
        </Spacings.Stack>

        {data?.timezoneDrift ? (
          <ContentNotification type="error">
            <Spacings.Stack scale="xs">
              <Text.Body isBold>{data.timezoneDrift.message}</Text.Body>
              {Object.entries(data.timezoneDrift.byTimezone).map(
                ([timezone, ids]) => (
                  <Text.Detail key={timezone}>{`${timezone}: ${ids.join(
                    ', '
                  )}`}</Text.Detail>
                )
              )}
            </Spacings.Stack>
          </ContentNotification>
        ) : null}

        {(data?.invalid.length ?? 0) > 0 ? (
          <ContentNotification type="warning">
            {intl.formatMessage(messages.invalidDescriptors, {
              count: data?.invalid.length ?? 0,
              keys: (data?.invalid ?? []).map((entry) => entry.key).join(', '),
            })}
          </ContentNotification>
        ) : null}

        {sources.length === 0 ? (
          <ContentNotification type="info">
            {intl.formatMessage(messages.none)}
          </ContentNotification>
        ) : (
          <Spacings.Stack scale="s">
            <DataTable
              columns={columns}
              rows={sources.map((source) => ({
                id: source.sourceId,
                ...source,
              }))}
              itemRenderer={(row, column) =>
                render(row as unknown as DataSourceSummary, column.key)
              }
            />
            {data?.loadedAt ? (
              <Text.Caption tone="secondary">
                {intl.formatMessage(messages.loadedAt, {
                  timestamp: intl.formatDate(data.loadedAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
              </Text.Caption>
            ) : null}
          </Spacings.Stack>
        )}
      </Spacings.Stack>
    </PageContentFull>
  );
};
DatasourceAdmin.displayName = 'DatasourceAdmin';

export default DatasourceAdmin;
