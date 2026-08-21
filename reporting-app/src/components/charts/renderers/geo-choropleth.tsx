import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import Spacings from '@commercetools-uikit/spacings';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { ContentNotification } from '@commercetools-uikit/notifications';
import {
  ensureEchartsRegistered,
  echarts,
  type EChartsOption,
} from '../echarts-base/register-echarts';
import EChart from '../echarts-base/echart';
import { baseOption } from '../echarts-base/base-option';
import { readChartTheme, type ChartTheme } from '../echarts-base/theme';
import { columnById, toRegions } from '../adapters/shape';
import { formatCell, labelForMetric } from '../../common/format-metric';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';
import type { IntlShape } from 'react-intl';

/**
 * A choropleth: a metric coloured across geographic regions.
 *
 * The map GeoJSON is dynamically imported so it only loads when a geo tile actually renders,
 * and registered with ECharts by name. A region value with no matching map feature is
 * reported as a warning, never silently dropped — an unmatched country code is a data issue
 * the operator should see.
 */

export interface GeoInput {
  spec: ChartSpec;
  regions: Array<{ name: string; value: number }>;
  mapName: string;
  theme: ChartTheme;
  formatValue: (value: number) => string;
}

export const buildGeoOption = (input: GeoInput): EChartsOption => {
  const { regions, mapName, theme } = input;
  const values = regions.map((r) => r.value);
  return {
    ...baseOption(theme),
    tooltip: {
      ...baseOption(theme).tooltip,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value?: number };
        return `${p.name}<br/><strong>${
          typeof p.value === 'number' && Number.isFinite(p.value)
            ? input.formatValue(p.value)
            : '—'
        }</strong>`;
      },
    },
    visualMap: {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      calculable: true,
      left: 8,
      bottom: 8,
      inRange: { color: theme.sequential },
      textStyle: { color: theme.textSecondary },
    },
    series: [
      {
        type: 'map',
        map: mapName,
        roam: false,
        emphasis: { label: { show: false } },
        itemStyle: { borderColor: theme.axisLine },
        data: regions,
      },
    ],
  };
};

const GeoChoropleth = ({ spec, columns, rows, height }: RendererProps) => {
  const intl = useIntl();
  const [ready, setReady] = useState(false);
  const [mapName, setMapName] = useState<string | null>(null);

  const requested = spec.options?.map ?? 'world';

  useEffect(() => {
    let active = true;
    void (async () => {
      ensureEchartsRegistered();
      // Only the placeholder is bundled today; a real per-region GeoJSON slots in here.
      const module = await import('../../../assets/geo/world-lite');
      if (!active) return;
      const name = module.MAP_NAME;
      // registerMap is idempotent for our purposes; re-registering the same name is harmless.
      echarts.registerMap(name, module.default as never);
      setMapName(name);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [requested]);

  const regionField = spec.encoding.region?.field ?? '';
  const valueField =
    spec.encoding.value?.field ?? spec.encoding.y?.[0]?.field ?? '';
  const valueColumn = columnById(columns, valueField);
  const regions = toRegions(rows, regionField, valueField);

  if (!ready || !mapName) return <LoadingSpinner scale="s" />;

  // Surface region codes that the map does not know about — a data-quality signal.
  const known = new Set(
    ((): string[] => {
      const map = echarts.getMap(mapName) as {
        geoJson?: { features?: Array<{ properties?: { name?: string } }> };
      } | null;
      return (map?.geoJson?.features ?? [])
        .map((f) => f.properties?.name ?? '')
        .filter(Boolean);
    })()
  );
  const unmatched = regions
    .map((r) => r.name)
    .filter((name) => known.size > 0 && !known.has(name));

  const option = buildGeoOption({
    spec,
    regions,
    mapName,
    theme: readChartTheme(),
    formatValue: (v) =>
      valueColumn
        ? formatCell(intl as IntlShape, valueColumn, v)
        : intl.formatNumber(v),
  });

  return (
    <Spacings.Stack scale="xs">
      {unmatched.length > 0 ? (
        <ContentNotification type="warning">
          {intl.formatMessage(
            {
              id: 'Reporting.geo.unmatched',
              defaultMessage:
                '{count} region code(s) are not on the map and are not shown: {codes}',
            },
            { count: unmatched.length, codes: unmatched.join(', ') }
          )}
        </ContentNotification>
      ) : null}
      <EChart
        option={option}
        height={height}
        ariaLabel={labelForMetric(intl, valueField) + ' by region'}
      />
    </Spacings.Stack>
  );
};
GeoChoropleth.displayName = 'GeoChoropleth';

const renderer: Renderer = {
  capabilities: {
    type: 'geo',
    requires: ['region', 'value'],
    supportsOptions: ['map', 'colourScale'],
    supportsComparison: false,
    supportsDrilldown: true,
    libraryFree: false,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) => {
    const problems = validateEncodedFields(spec, columns);
    if (!spec.encoding.region) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A choropleth needs `encoding.region`.',
      });
    }
    if (!spec.encoding.value && !spec.encoding.y?.length) {
      problems.push({
        code: 'MISSING_ENCODING',
        message: 'A choropleth needs a `value`.',
      });
    }
    return problems;
  },
  Component: GeoChoropleth,
};
export default renderer;
