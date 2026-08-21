import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { PageContentFull } from '@commercetools-frontend/application-components';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { actions, useAsyncDispatch } from '@commercetools-frontend/sdk';
import Card from '@commercetools-uikit/card';
import Constraints from '@commercetools-uikit/constraints';
import Grid from '@commercetools-uikit/grid';
import IconButton from '@commercetools-uikit/icon-button';
import { BinLinearIcon, PlusBoldIcon } from '@commercetools-uikit/icons';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import SelectInput from '@commercetools-uikit/select-input';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import TextField from '@commercetools-uikit/text-field';
import { ContentNotification } from '@commercetools-uikit/notifications';
import { useGatewayUrl } from '../../hooks/use-gateway-url';
import { useReportDefinitions } from '../../hooks/use-report-definitions';
import TileFrame from '../report-viewer/tile-frame';
import { METRICS } from '../../shared/semantic/metrics';
import { DIMENSIONS } from '../../shared/semantic/dimensions';
import { CHART_TYPES } from '../../shared/schema/chart-spec';
import { isRendererAvailable } from '../charts/registry';
import { labelForDimension, labelForMetric } from '../common/format-metric';
import {
  CATEGORIES,
  describeProblems,
  emptyDraft,
  emptyTile,
  toDefinition,
  type DraftReport,
  type DraftTile,
} from './draft-model';
import type { RunReportResponse } from '../../types/reporting';
import commonMessages from '../common/messages';
import messages from './messages';

/**
 * The report builder.
 *
 * Every choice is drawn from a registry, so a report can only reference things that exist:
 * metrics and dimensions from the semantic registry, chart types from the renderer registry
 * (only those actually implemented). The draft is assembled and validated against the same
 * schema the gateway uses, and "Preview" runs it through the gateway's preview endpoint — so
 * what the author sees is exactly what a saved report will show. Saving writes a Custom
 * Object via the operator's own permissions; the gateway then surfaces it in the catalogue.
 */
const ReportBuilder = () => {
  const intl = useIntl();
  const dispatch = useAsyncDispatch();
  const { gatewayUrl, isConfigured } = useGatewayUrl();
  const audiencePolicy = useApplicationContext(
    (ctx) =>
      (ctx.environment as { forwardToAudiencePolicy?: string })
        .forwardToAudiencePolicy ?? 'forward-url-origin'
  );
  const { reports, save, remove } = useReportDefinitions();

  const [draft, setDraft] = useState<DraftReport>(emptyDraft());
  const [preview, setPreview] = useState<RunReportResponse | undefined>();
  const [status, setStatus] = useState<
    { tone: 'success' | 'error'; message: string } | undefined
  >();
  const [busy, setBusy] = useState(false);

  const metricOptions = useMemo(
    () =>
      Object.keys(METRICS).map((id) => ({
        value: id,
        label: labelForMetric(intl, id),
      })),
    [intl]
  );
  const dimensionOptions = useMemo(
    () =>
      Object.keys(DIMENSIONS).map((id) => ({
        value: id,
        label: labelForDimension(intl, id),
      })),
    [intl]
  );
  // Only chart types with an implemented renderer are offered — the builder cannot author
  // a chart that will not draw.
  const chartOptions = CHART_TYPES.filter((t) => isRendererAvailable(t)).map(
    (t) => ({ value: t, label: t })
  );

  const problems = describeProblems(draft);
  const canSave = problems.length === 0;

  const patchTile = (index: number, patch: Partial<DraftTile>) =>
    setDraft((d) => ({
      ...d,
      tiles: d.tiles.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));

  const runPreview = async () => {
    if (!canSave || !isConfigured) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const definition = toDefinition(draft);
      const response = (await dispatch(
        actions.forwardTo.post({
          uri: `${gatewayUrl}/gateway/reports/preview`,
          payload: { definition, request: {} },
          audiencePolicy: audiencePolicy as 'forward-url-origin',
          includeUserPermissions: true,
        })
      )) as RunReportResponse;
      setPreview(response);
    } catch (error) {
      setStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setStatus(undefined);
    try {
      await save(toDefinition(draft));
      setStatus({
        tone: 'success',
        message: intl.formatMessage(messages.saved),
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const previewTile = (tileId: string) =>
    preview?.tiles.find((t) => t.tileId === tileId);
  const definitionForPreview = canSave ? toDefinition(draft) : undefined;

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

        {status ? (
          <ContentNotification
            type={status.tone === 'success' ? 'success' : 'error'}
          >
            {status.message}
          </ContentNotification>
        ) : null}

        <Card insetScale="m">
          <Spacings.Stack scale="m">
            <Spacings.Inline scale="m">
              <Constraints.Horizontal max={5}>
                <TextField
                  title={intl.formatMessage(messages.reportId)}
                  value={draft.id}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, id: e.target.value }))
                  }
                />
              </Constraints.Horizontal>
              <Constraints.Horizontal max={6}>
                <TextField
                  title={intl.formatMessage(messages.reportTitle)}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                />
              </Constraints.Horizontal>
              <Constraints.Horizontal max={4}>
                <Spacings.Stack scale="xs">
                  <Text.Detail tone="secondary">
                    {intl.formatMessage(messages.category)}
                  </Text.Detail>
                  <SelectInput
                    name="category"
                    value={draft.category}
                    options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        category: e.target.value as DraftReport['category'],
                      }))
                    }
                  />
                </Spacings.Stack>
              </Constraints.Horizontal>
            </Spacings.Inline>
          </Spacings.Stack>
        </Card>

        <Spacings.Inline justifyContent="space-between" alignItems="center">
          <Text.Subheadline as="h4">
            {intl.formatMessage(messages.tiles)}
          </Text.Subheadline>
          <SecondaryButton
            iconLeft={<PlusBoldIcon />}
            label={intl.formatMessage(messages.addTile)}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                tiles: [...d.tiles, emptyTile(d.tiles.length + 1)],
              }))
            }
          />
        </Spacings.Inline>

        {draft.tiles.map((tile, index) => (
          <Card key={tile.id} insetScale="m">
            <Spacings.Stack scale="s">
              <Spacings.Inline
                justifyContent="space-between"
                alignItems="center"
              >
                <Text.Detail isBold>{tile.title || tile.id}</Text.Detail>
                <IconButton
                  label={intl.formatMessage(messages.removeTile)}
                  icon={<BinLinearIcon />}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      tiles: d.tiles.filter((_, i) => i !== index),
                    }))
                  }
                />
              </Spacings.Inline>
              <Spacings.Inline scale="m" alignItems="flex-end">
                <Constraints.Horizontal max={5}>
                  <TextField
                    title={intl.formatMessage(messages.tileTitle)}
                    value={tile.title}
                    onChange={(e) =>
                      patchTile(index, { title: e.target.value })
                    }
                  />
                </Constraints.Horizontal>
                <Constraints.Horizontal max={4}>
                  <Spacings.Stack scale="xs">
                    <Text.Detail tone="secondary">
                      {intl.formatMessage(messages.chartType)}
                    </Text.Detail>
                    <SelectInput
                      name={`chart-${tile.id}`}
                      value={tile.chartType}
                      options={chartOptions}
                      onChange={(e) =>
                        patchTile(index, {
                          chartType: e.target.value as DraftTile['chartType'],
                        })
                      }
                    />
                  </Spacings.Stack>
                </Constraints.Horizontal>
              </Spacings.Inline>
              <Spacings.Stack scale="xs">
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.metrics)}
                </Text.Detail>
                <SelectInput
                  name={`metrics-${tile.id}`}
                  isMulti
                  value={tile.metrics}
                  options={metricOptions}
                  onChange={(e) =>
                    patchTile(index, {
                      metrics: (e.target.value as string[]) ?? [],
                    })
                  }
                />
              </Spacings.Stack>
              <Spacings.Stack scale="xs">
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.dimensions)}
                </Text.Detail>
                <SelectInput
                  name={`dims-${tile.id}`}
                  isMulti
                  value={tile.dimensions}
                  options={dimensionOptions}
                  onChange={(e) =>
                    patchTile(index, {
                      dimensions: (e.target.value as string[]) ?? [],
                    })
                  }
                />
              </Spacings.Stack>
            </Spacings.Stack>
          </Card>
        ))}

        {problems.length > 0 ? (
          <ContentNotification type="warning">
            <Spacings.Stack scale="xs">
              <Text.Detail isBold>
                {intl.formatMessage(messages.cannotSave)}
              </Text.Detail>
              {problems.map((p) => (
                <Text.Detail key={p}>{p}</Text.Detail>
              ))}
            </Spacings.Stack>
          </ContentNotification>
        ) : null}

        <Spacings.Inline scale="m">
          <SecondaryButton
            label={intl.formatMessage(messages.preview)}
            isDisabled={!canSave || busy || !isConfigured}
            onClick={() => void runPreview()}
          />
          <PrimaryButton
            label={intl.formatMessage(messages.save)}
            isDisabled={!canSave || busy}
            onClick={() => void onSave()}
          />
          <Text.Detail tone="secondary">
            {intl.formatMessage(messages.previewHint)}
          </Text.Detail>
        </Spacings.Inline>

        {preview && definitionForPreview ? (
          <Spacings.Stack scale="m">
            <Text.Subheadline as="h4">
              {intl.formatMessage(messages.preview)}
            </Text.Subheadline>
            <Grid gridGap="16px" gridTemplateColumns="repeat(12, 1fr)">
              {definitionForPreview.tiles.map((tile) => (
                <Grid.Item key={tile.id} gridColumn={`span ${tile.span}`}>
                  <TileFrame
                    tile={tile}
                    {...(previewTile(tile.id)
                      ? { result: previewTile(tile.id) }
                      : {})}
                    loading={busy}
                    title={tile.title?.en ?? tile.id}
                  />
                </Grid.Item>
              ))}
            </Grid>
          </Spacings.Stack>
        ) : null}

        {reports.length > 0 ? (
          <Spacings.Stack scale="s">
            <Text.Subheadline as="h4">
              {intl.formatMessage(messages.existing)}
            </Text.Subheadline>
            {reports.map((r) => (
              <Card key={r.key} insetScale="s">
                <Spacings.Inline
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Text.Body>
                    {r.definition.title?.en ?? r.definition.id}
                  </Text.Body>
                  <Spacings.Inline scale="xs">
                    <SecondaryButton
                      label={intl.formatMessage(messages.delete)}
                      isDisabled={busy}
                      onClick={() => void remove(r.key)}
                    />
                  </Spacings.Inline>
                </Spacings.Inline>
              </Card>
            ))}
          </Spacings.Stack>
        ) : null}

        {!isConfigured ? (
          <ContentNotification type="info">
            {intl.formatMessage(commonMessages.gatewayNotConfigured)}
          </ContentNotification>
        ) : null}
      </Spacings.Stack>
    </PageContentFull>
  );
};
ReportBuilder.displayName = 'ReportBuilder';

export default ReportBuilder;
