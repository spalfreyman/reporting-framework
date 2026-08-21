import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink, useParams, useRouteMatch } from 'react-router-dom';
import { PageContentFull } from '@commercetools-frontend/application-components';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import Grid from '@commercetools-uikit/grid';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import { ContentNotification } from '@commercetools-uikit/notifications';
import { useGatewayFetch } from '../../hooks/use-gateway-fetch';
import { useReportQuery } from '../../hooks/use-report-query';
import { useReportFilters, toRequest } from '../../hooks/use-report-filters';
import { reportMessages } from '../../i18n/messages/shared';
import { labelForMetric } from '../common/format-metric';
import FilterBar from './filter-bar';
import TileFrame from './tile-frame';
import commonMessages from '../common/messages';
import messages from './messages';
import type { Availability, CatalogueEntry } from '../../types/reporting';
import type { ReportDefinition } from '../../shared/schema/report-definition';

type DefinitionResponse = {
  report: ReportDefinition;
  availability: Availability;
};

/**
 * The report viewer.
 *
 * The definition comes from the gateway, not from this bundle, so a customer's stored or
 * overridden report renders through exactly the same path as a built-in one.
 */
const ReportViewer = () => {
  const intl = useIntl();
  const match = useRouteMatch();
  const { reportId } = useParams<{ reportId: string }>();

  const timeZone = useApplicationContext(
    (context) => context.user?.timeZone ?? 'UTC'
  );
  const locale = useApplicationContext((context) => context.dataLocale ?? 'en');

  const {
    data: definitionData,
    loading: definitionLoading,
    error: definitionError,
  } = useGatewayFetch<DefinitionResponse>(
    reportId ? `/gateway/reports/${reportId}` : null
  );

  const report = definitionData?.report;

  /**
   * The filter hook needs the report's declared defaults and allowed filters. A definition
   * is a superset of a catalogue entry, so it can stand in directly.
   */
  const catalogueShape = report as unknown as CatalogueEntry | undefined;
  const { filters, patch, shareableUrl } = useReportFilters(catalogueShape);

  const request = useMemo(
    () => toRequest(filters, timeZone, locale),
    [filters, timeZone, locale]
  );

  const { data, loading, error, refetch } = useReportQuery(reportId, request);

  const titleOf = (): string => {
    if (!report) return reportId ?? '';
    if (report.titleKey) {
      const message =
        reportMessages[report.titleKey as keyof typeof reportMessages];
      if (message) return intl.formatMessage(message);
    }
    return report.title?.[locale] ?? report.title?.en ?? report.id;
  };

  const tileTitle = (tileId: string): string => {
    const tile = report?.tiles.find((t) => t.id === tileId);
    if (!tile) return tileId;

    if (tile.titleKey) {
      const reportMessage =
        reportMessages[tile.titleKey as keyof typeof reportMessages];
      if (reportMessage) return intl.formatMessage(reportMessage);

      /**
       * A tile named after its metric (a KPI, typically) resolves through the shared metric
       * label table. Going via the declared messages rather than composing an id on the fly
       * matters for two reasons: there is exactly one label per metric across the whole
       * application, and formatjs can only extract messages whose id is a literal — a
       * computed id would silently never reach the translators.
       */
      const metricId = tile.query.metrics[0];
      if (tile.titleKey.startsWith('metric.') && metricId) {
        return labelForMetric(intl, metricId);
      }
      return tile.titleKey;
    }

    return tile.title?.[locale] ?? tile.title?.en ?? tile.id;
  };

  if (definitionLoading) return <LoadingSpinner scale="l" />;

  if (definitionError || !report) {
    return (
      <ContentNotification type="error">
        {definitionError?.message === 'GATEWAY_NOT_CONFIGURED'
          ? intl.formatMessage(commonMessages.gatewayNotConfigured)
          : definitionError?.message ?? 'This report could not be loaded.'}
      </ContentNotification>
    );
  }

  const resultByTile = new Map(
    (data?.tiles ?? []).map((tile) => [tile.tileId, tile])
  );

  return (
    <PageContentFull>
      <Spacings.Stack scale="l">
        <Spacings.Stack scale="xs">
          <RouterLink
            to={`${match.url.replace(/\/reports\/[^/]+$/, '/catalogue')}`}
          >
            <Text.Detail tone="primary">
              {intl.formatMessage(messages.backToCatalogue)}
            </Text.Detail>
          </RouterLink>
          <Text.Headline as="h1">{titleOf()}</Text.Headline>
          {data ? (
            <Spacings.Inline scale="s" alignItems="center">
              <Text.Detail tone="secondary">
                {intl.formatMessage(messages.showingRange, {
                  from: data.range.from,
                  to: data.range.to,
                  grain: data.grain,
                })}
              </Text.Detail>
              {/* MIN across contributors, so this never overstates freshness. */}
              {data.dataAsOf ? (
                <Text.Detail tone="secondary">
                  {intl.formatMessage(commonMessages.dataAsOf, {
                    timestamp: intl.formatDate(data.dataAsOf, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                </Text.Detail>
              ) : null}
            </Spacings.Inline>
          ) : null}
        </Spacings.Stack>

        <FilterBar
          report={report as unknown as CatalogueEntry}
          filters={filters}
          onChange={patch}
          shareableUrl={shareableUrl}
          onRefresh={() => void refetch()}
        />

        {error ? (
          <ContentNotification type="error">
            {error.message === 'GATEWAY_NOT_CONFIGURED'
              ? intl.formatMessage(commonMessages.gatewayNotConfigured)
              : error.message}
          </ContentNotification>
        ) : null}

        {data?.status === 'failed' ? (
          <ContentNotification type="error">
            {intl.formatMessage(messages.reportFailed)}
          </ContentNotification>
        ) : null}
        {data?.status === 'partial' ? (
          <ContentNotification type="warning">
            {intl.formatMessage(messages.reportPartial)}
          </ContentNotification>
        ) : null}
        {data?.notices.map((notice) => (
          <ContentNotification
            key={`${notice.code}-${notice.message}`}
            type={notice.severity === 'error' ? 'error' : 'warning'}
          >
            {notice.message}
          </ContentNotification>
        ))}

        {report.layout.rows.map((row) => (
          <Grid
            key={row.id}
            gridGap="16px"
            gridTemplateColumns="repeat(12, 1fr)"
          >
            {row.tileIds.map((tileId) => {
              const tile = report.tiles.find((t) => t.id === tileId);
              if (!tile) return null;
              return (
                <Grid.Item key={tileId} gridColumn={`span ${tile.span}`}>
                  <TileFrame
                    tile={tile}
                    {...(resultByTile.get(tileId)
                      ? { result: resultByTile.get(tileId) }
                      : {})}
                    loading={loading}
                    title={tileTitle(tileId)}
                  />
                </Grid.Item>
              );
            })}
          </Grid>
        ))}
      </Spacings.Stack>
    </PageContentFull>
  );
};
ReportViewer.displayName = 'ReportViewer';

export default ReportViewer;
