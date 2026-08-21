import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import Card from '@commercetools-uikit/card';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import Stamp from '@commercetools-uikit/stamp';
import FlatButton from '@commercetools-uikit/flat-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { ContentNotification } from '@commercetools-uikit/notifications';
import ResultSetTable from '../common/result-set-table';
import { loadRenderer } from '../charts/registry';
import type { Renderer } from '../charts/types';
import commonMessages from '../common/messages';
import { reportMessages } from '../../i18n/messages/shared';
import type { Tile } from '../../shared/schema/report-definition';
import type { TileResult } from '../../types/reporting';

type Props = {
  tile: Tile;
  result?: TileResult;
  loading: boolean;
  title: string;
};

/**
 * The chrome around every tile: title, provenance, freshness, states, and the
 * "view as table" toggle.
 *
 * The toggle is the substantive accessibility answer for chart tiles — ECharts draws to
 * canvas, which assistive technology cannot read — so it is part of the frame rather than
 * something each renderer has to remember.
 */
const TileFrame = ({ tile, result, loading, title }: Props) => {
  const intl = useIntl();
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [rendererMissing, setRendererMissing] = useState(false);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let active = true;
    void loadRenderer(tile.chart.type).then((loaded) => {
      if (!active) return;
      setRenderer(loaded);
      setRendererMissing(loaded === null);
    });
    return () => {
      active = false;
    };
  }, [tile.chart.type]);

  const isDemo = result?.contributions.some((c) => c.status === 'degraded');
  const sources = [
    ...new Set(result?.provenance.map((p) => p.sourceId).filter(Boolean)),
  ];

  const body = () => {
    if (loading && !result) return <LoadingSpinner scale="s" />;

    if (result?.status === 'unavailable') {
      return (
        <Spacings.Stack scale="xs">
          <Stamp tone="information" isCondensed>
            {intl.formatMessage(commonMessages.tileUnavailable)}
          </Stamp>
          {/* Say WHY, and what to do about it — a bare "unavailable" teaches nothing. */}
          {result.unavailableMetrics.map((entry) => (
            <Text.Detail key={entry.metric} tone="secondary">
              {`${entry.metric}: ${entry.reason}`}
            </Text.Detail>
          ))}
          {tile.emptyStateKey ? (
            <Text.Detail tone="secondary">
              {intl.formatMessage(
                reportMessages[
                  tile.emptyStateKey as keyof typeof reportMessages
                ] ?? {
                  id: tile.emptyStateKey,
                  defaultMessage: tile.emptyStateKey,
                }
              )}
            </Text.Detail>
          ) : null}
        </Spacings.Stack>
      );
    }

    if (!result || result.rows.length === 0) {
      return (
        <Text.Detail tone="secondary">
          {intl.formatMessage(commonMessages.noData)}
        </Text.Detail>
      );
    }

    if (rendererMissing) {
      // Fall back to the data rather than an empty box: a missing renderer must not hide
      // figures the gateway already fetched.
      return <ResultSetTable columns={result.columns} rows={result.rows} />;
    }

    if (!renderer) return <LoadingSpinner scale="s" />;

    const problems = renderer.validate(tile.chart, result.columns);
    if (problems.length > 0) {
      return (
        <Spacings.Stack scale="xs">
          <ContentNotification type="warning">
            {problems.map((p) => p.message).join(' ')}
          </ContentNotification>
          <ResultSetTable columns={result.columns} rows={result.rows} />
        </Spacings.Stack>
      );
    }

    if (showTable) {
      return <ResultSetTable columns={result.columns} rows={result.rows} />;
    }

    const { Component } = renderer;
    return (
      <Component
        spec={tile.chart}
        columns={result.columns}
        rows={result.rows}
        totals={result.totals}
        {...(result.comparison ? { comparison: result.comparison } : {})}
        height={tile.chart.type === 'kpi' ? 0 : 280}
      />
    );
  };

  const canToggleTable =
    Boolean(result) &&
    result?.status !== 'unavailable' &&
    (result?.rows.length ?? 0) > 0 &&
    !rendererMissing &&
    renderer !== null &&
    !renderer.capabilities.libraryFree;

  return (
    <Card insetScale="m">
      <Spacings.Stack scale="s">
        <Spacings.Inline justifyContent="space-between" alignItems="center">
          <Text.Subheadline as="h4">{title}</Text.Subheadline>
          <Spacings.Inline scale="xs" alignItems="center">
            {isDemo ? (
              <Stamp tone="warning" isCondensed>
                {intl.formatMessage(commonMessages.demoData)}
              </Stamp>
            ) : null}
            {result?.status === 'partial' ? (
              <Stamp tone="warning" isCondensed>
                {intl.formatMessage(commonMessages.partialData)}
              </Stamp>
            ) : null}
            {canToggleTable ? (
              <FlatButton
                tone="primary"
                label={intl.formatMessage(
                  showTable
                    ? commonMessages.viewAsChart
                    : commonMessages.viewAsTable
                )}
                onClick={() => setShowTable((previous) => !previous)}
              />
            ) : null}
          </Spacings.Inline>
        </Spacings.Inline>

        <div
          role={renderer?.capabilities.libraryFree ? undefined : 'img'}
          aria-label={title}
        >
          {body()}
        </div>

        {result?.notices.length ? (
          <Spacings.Stack scale="xs">
            {result.notices
              .filter((notice) => notice.severity !== 'info')
              .map((notice) => (
                <Text.Detail
                  key={`${notice.code}-${notice.message}`}
                  tone="secondary"
                >
                  {notice.message}
                </Text.Detail>
              ))}
          </Spacings.Stack>
        ) : null}

        {sources.length > 0 ? (
          <Text.Caption tone="secondary">
            {intl.formatMessage(commonMessages.servedBy, {
              sources: sources.join(', '),
            })}
          </Text.Caption>
        ) : null}
      </Spacings.Stack>
    </Card>
  );
};
TileFrame.displayName = 'TileFrame';

export default TileFrame;
