import { SignJWT, importPKCS8 } from 'jose';
import { readConfiguration } from './env.js';
import { DspFailure } from './shared/dsp/server.js';
import { getMetric } from './shared/semantic/metrics.js';
import type { ColumnMeta, SourceQuery } from './shared/schema/query.js';
import { DIMENSION_TO_GA4, METRIC_TO_GA4, ga4DateToIso } from './translate.js';
import { addDays } from './shared/util/date-range.js';

/**
 * The live GA4 Data API path.
 *
 * A single `runReport` per query. Any GA4 dimension/metric the framework does not map is a
 * planning error surfaced as a capability failure, so the gateway refreshes the descriptor
 * rather than treating it as an outage.
 *
 * This talks to the GA4 Data API over REST rather than through `@google-analytics/data`. That
 * SDK is gRPC-based and drags `@grpc/grpc-js` (and, via google-gax, `brace-expansion`) into the
 * deployed tree, both of which Connect's software-composition analysis flags. The REST endpoint
 * is the same API; service-account auth is a standard signed-JWT bearer exchange, done here with
 * `jose` (zero dependencies).
 */

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const RUN_REPORT_BASE = 'https://analyticsdata.googleapis.com/v1beta';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface Ga4RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string | null }>;
    metricValues?: Array<{ value?: string | null }>;
  }>;
  metadata?: { samplingMetadatas?: unknown[] };
}

// A GA4 access token is good for ~1h; cache it and refresh a minute early. The cached value is a
// Promise so concurrent queries share a single token exchange rather than each minting one.
let tokenCache: { token: Promise<string>; expiresAtMs: number } | undefined;

const mintAccessToken = async (account: ServiceAccount): Promise<string> => {
  const tokenUri = account.token_uri ?? DEFAULT_TOKEN_URI;
  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: GA4_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`GA4 token exchange failed: ${response.status}`);
  }
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('GA4 token exchange returned no access_token');
  return json.access_token;
};

const getAccessToken = (): Promise<string> => {
  const config = readConfiguration();
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now) return tokenCache.token;

  const account = JSON.parse(config.GA4_SERVICE_ACCOUNT_JSON as string) as ServiceAccount;
  const token = mintAccessToken(account);
  // Hold the token for 55 minutes; on a mint failure, drop the cache so the next call retries.
  tokenCache = { token, expiresAtMs: now + 55 * 60 * 1000 };
  token.catch(() => {
    tokenCache = undefined;
  });
  return token;
};

/** Test-only: clears the memoised access token. */
export const resetGa4AuthCache = (): void => {
  tokenCache = undefined;
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

  const token = await getAccessToken();
  const httpResponse = await fetch(
    `${RUN_REPORT_BASE}/properties/${config.GA4_PROPERTY_ID}:runReport`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        // GA4 wants YYYY-MM-DD and an INCLUSIVE endDate; our timeRange is half-open [from, to),
        // so the inclusive end is the day before `to`.
        dateRanges: [{ startDate: query.timeRange.from, endDate: addDays(query.timeRange.to, -1) }],
        dimensions: ga4Dimensions,
        metrics: ga4Metrics,
        limit: '100000',
      }),
    }
  );
  if (!httpResponse.ok) {
    throw new Error(`GA4 runReport failed: ${httpResponse.status}`);
  }
  const response = (await httpResponse.json()) as Ga4RunReportResponse;

  const rows = (response.rows ?? []).map((row) => {
    const dims = dimensionIds.map((id, i) => {
      const raw = row.dimensionValues?.[i]?.value ?? null;
      return id === 'date' && raw ? ga4DateToIso(raw) : raw;
    });
    const metrics = query.metrics.map((_, i) => {
      const raw = row.metricValues?.[i]?.value;
      return raw === undefined || raw === null ? null : Number(raw);
    });
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
  const sampled = (response.metadata?.samplingMetadatas?.length ?? 0) > 0 ? true : true;

  return { columns, rows, sampled };
};
