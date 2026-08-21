import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { readConfiguration } from './env.js';
import { DspFailure } from './shared/dsp/server.js';
import { getMetric } from './shared/semantic/metrics.js';
import type { ColumnMeta, SourceQuery } from './shared/schema/query.js';
import { DIMENSION_TO_GA4, METRIC_TO_GA4, ga4DateToIso, isoDateToGa4 } from './translate.js';

/**
 * The live GA4 Data API path.
 *
 * A single `runReport` per query. Any GA4 dimension/metric the framework does not map is a
 * planning error surfaced as a capability failure, so the gateway refreshes the descriptor
 * rather than treating it as an outage.
 */

let client: BetaAnalyticsDataClient | undefined;

const getClient = (): BetaAnalyticsDataClient => {
  if (client) return client;
  const config = readConfiguration();
  const credentials = JSON.parse(config.GA4_SERVICE_ACCOUNT_JSON as string) as {
    client_email: string;
    private_key: string;
  };
  client = new BetaAnalyticsDataClient({
    credentials: { client_email: credentials.client_email, private_key: credentials.private_key },
  });
  return client;
};

export const runGa4Report = async (
  query: SourceQuery
): Promise<{
  columns: ColumnMeta[];
  rows: Array<Array<string | number | null>>;
  sampled: boolean;
}> => {
  const config = readConfiguration();
  if (!query.timeRange) {
    throw new DspFailure('UNSUPPORTED_GRAIN', 'GA4 queries need a time range.');
  }

  const dimensionIds = query.dimensions.includes('date')
    ? query.dimensions
    : ['date', ...query.dimensions];

  const ga4Dimensions = dimensionIds.map((id) => {
    const name = DIMENSION_TO_GA4[id];
    if (!name) throw new DspFailure('UNSUPPORTED_DIMENSION', `GA4 cannot serve dimension ${id}`);
    return { name };
  });
  const ga4Metrics = query.metrics.map((id) => {
    const name = METRIC_TO_GA4[id];
    if (!name) throw new DspFailure('UNSUPPORTED_METRIC', `GA4 cannot serve metric ${id}`);
    return { name };
  });

  const [response] = await getClient().runReport({
    property: `properties/${config.GA4_PROPERTY_ID}`,
    dateRanges: [{ startDate: query.timeRange.from, endDate: isoDateToGa4(query.timeRange.to) }],
    dimensions: ga4Dimensions,
    metrics: ga4Metrics,
    limit: 100_000,
  });

  const dateIndex = dimensionIds.indexOf('date');
  const rows = (response.rows ?? []).map((row) => {
    const dims = dimensionIds.map((id, i) => {
      const raw = row.dimensionValues?.[i]?.value ?? null;
      return id === 'date' && raw ? ga4DateToIso(raw) : raw;
    });
    const metrics = query.metrics.map((_, i) => {
      const raw = row.metricValues?.[i]?.value;
      return raw === undefined || raw === null ? null : Number(raw);
    });
    void dateIndex;
    return [...dims, ...metrics];
  });

  const columns: ColumnMeta[] = [
    ...dimensionIds.map((id) => ({
      id,
      role: id === 'date' ? ('time' as const) : ('dimension' as const),
      valueType: id === 'date' ? ('time' as const) : ('string' as const),
      exactness: 'sampled' as const,
      nullMeaning: 'unknown' as const,
    })),
    ...query.metrics.map((id) => ({
      id,
      role: 'metric' as const,
      valueType: getMetric(id)?.valueType ?? ('count' as const),
      exactness: 'sampled' as const,
      nullMeaning: 'zero' as const,
    })),
  ];

  // GA4 flags sampling per-response; treat any sampled range as sampled overall.
  const sampled =
    (response.metadata?.samplingMetadatas?.length ?? 0) > 0 ? true : true;

  return { columns, rows, sampled };
};
