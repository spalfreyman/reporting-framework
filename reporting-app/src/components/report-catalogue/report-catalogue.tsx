import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink, useRouteMatch } from 'react-router-dom';
import { PageContentFull } from '@commercetools-frontend/application-components';
import Card from '@commercetools-uikit/card';
import Constraints from '@commercetools-uikit/constraints';
import Grid from '@commercetools-uikit/grid';
import SearchTextInput from '@commercetools-uikit/search-text-input';
import SelectInput from '@commercetools-uikit/select-input';
import Spacings from '@commercetools-uikit/spacings';
import Stamp from '@commercetools-uikit/stamp';
import Text from '@commercetools-uikit/text';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { ContentNotification } from '@commercetools-uikit/notifications';
import { useGatewayFetch } from '../../hooks/use-gateway-fetch';
import { reportMessages } from '../../i18n/messages/shared';
import commonMessages from '../common/messages';
import messages from './messages';
import type { CatalogueEntry, CatalogueResponse } from '../../types/reporting';

const CATEGORY_LABELS = {
  trading: messages.categoryTrading,
  merchandising: messages.categoryMerchandising,
  customer: messages.categoryCustomer,
  marketing: messages.categoryMarketing,
  promotions: messages.categoryPromotions,
  operations: messages.categoryOperations,
  inventory: messages.categoryInventory,
} as const;

const ORDER: Array<keyof typeof CATEGORY_LABELS> = [
  'trading',
  'merchandising',
  'customer',
  'marketing',
  'promotions',
  'operations',
  'inventory',
];

/**
 * The report catalogue.
 *
 * What appears here is decided by the GATEWAY, from the signed-in user's verified
 * permissions and the data sources actually installed. A report blocked by permissions is
 * omitted entirely — report titles can themselves be sensitive — while one blocked only by a
 * missing connector is shown with the reason, so the operator knows what to install.
 */
const ReportCatalogue = () => {
  const intl = useIntl();
  const match = useRouteMatch();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const { data, loading, error } =
    useGatewayFetch<CatalogueResponse>('/gateway/reports');

  const titleOf = (report: CatalogueEntry): string => {
    if (report.titleKey) {
      const message =
        reportMessages[report.titleKey as keyof typeof reportMessages];
      if (message) return intl.formatMessage(message);
    }
    return report.title?.[intl.locale] ?? report.title?.en ?? report.id;
  };

  const descriptionOf = (report: CatalogueEntry): string => {
    if (report.descriptionKey) {
      const message =
        reportMessages[report.descriptionKey as keyof typeof reportMessages];
      if (message) return intl.formatMessage(message);
    }
    return report.description?.[intl.locale] ?? report.description?.en ?? '';
  };

  const filtered = useMemo(() => {
    const reports = data?.reports ?? [];
    const needle = search.trim().toLowerCase();
    return reports.filter((report) => {
      if (category && report.category !== category) return false;
      if (!needle) return true;
      return (
        titleOf(report).toLowerCase().includes(needle) ||
        descriptionOf(report).toLowerCase().includes(needle) ||
        report.audience.some((role) => role.toLowerCase().includes(needle))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, category, intl.locale]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, CatalogueEntry[]>();
    for (const report of filtered) {
      byCategory.set(report.category, [
        ...(byCategory.get(report.category) ?? []),
        report,
      ]);
    }
    return ORDER.filter((key) => byCategory.has(key)).map((key) => ({
      category: key,
      reports: byCategory.get(key) ?? [],
    }));
  }, [filtered]);

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

  const sources = data?.registry.sources ?? [];

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

        {sources.length === 0 ? (
          <ContentNotification type="info">
            {intl.formatMessage(messages.noSources)}
          </ContentNotification>
        ) : (
          <Text.Detail tone="secondary">
            {intl.formatMessage(messages.installedSources, {
              sources: sources.join(', '),
            })}
          </Text.Detail>
        )}

        <Spacings.Inline scale="m" alignItems="center">
          <Constraints.Horizontal max={7}>
            <SearchTextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSubmit={() => undefined}
              onReset={() => setSearch('')}
              placeholder={intl.formatMessage(messages.searchPlaceholder)}
            />
          </Constraints.Horizontal>
          <Constraints.Horizontal max={5}>
            <SelectInput
              name="category"
              value={category}
              onChange={(event) =>
                setCategory((event.target.value as string | null) || null)
              }
              isClearable
              placeholder={intl.formatMessage(messages.allCategories)}
              options={ORDER.map((key) => ({
                value: key,
                label: intl.formatMessage(CATEGORY_LABELS[key]),
              }))}
            />
          </Constraints.Horizontal>
        </Spacings.Inline>

        {grouped.length === 0 ? (
          <Text.Body tone="secondary">
            {intl.formatMessage(messages.noResults)}
          </Text.Body>
        ) : null}

        {grouped.map(({ category: key, reports }) => (
          <Spacings.Stack key={key} scale="m">
            <Text.Subheadline as="h4">
              {intl.formatMessage(CATEGORY_LABELS[key])}
            </Text.Subheadline>
            <Grid
              gridGap="16px"
              gridTemplateColumns="repeat(auto-fill, minmax(20rem, 1fr))"
            >
              {reports.map((report) => {
                const available = report.availability.state === 'available';
                return (
                  <Grid.Item key={report.id}>
                    <Card insetScale="m" theme={available ? 'light' : 'dark'}>
                      <Spacings.Stack scale="s">
                        <Spacings.Inline
                          justifyContent="space-between"
                          alignItems="center"
                        >
                          {available ? (
                            <RouterLink
                              to={`${match.url}/../reports/${report.id}`}
                            >
                              <Text.Subheadline as="h4" tone="primary">
                                {titleOf(report)}
                              </Text.Subheadline>
                            </RouterLink>
                          ) : (
                            <Text.Subheadline as="h4" tone="secondary">
                              {titleOf(report)}
                            </Text.Subheadline>
                          )}
                          {report.origin === 'custom' ? (
                            <Stamp tone="information" isCondensed>
                              {intl.formatMessage(messages.custom)}
                            </Stamp>
                          ) : null}
                        </Spacings.Inline>

                        <Text.Detail tone="secondary">
                          {descriptionOf(report)}
                        </Text.Detail>

                        {/* Say what is missing and what to install, not just "unavailable". */}
                        {report.availability.state === 'unavailable' ? (
                          <Spacings.Stack scale="xs">
                            <Stamp tone="warning" isCondensed>
                              {intl.formatMessage(messages.unavailable)}
                            </Stamp>
                            <Text.Caption tone="secondary">
                              {report.availability.reason}
                            </Text.Caption>
                          </Spacings.Stack>
                        ) : null}
                      </Spacings.Stack>
                    </Card>
                  </Grid.Item>
                );
              })}
            </Grid>
          </Spacings.Stack>
        ))}
      </Spacings.Stack>
    </PageContentFull>
  );
};
ReportCatalogue.displayName = 'ReportCatalogue';

export default ReportCatalogue;
