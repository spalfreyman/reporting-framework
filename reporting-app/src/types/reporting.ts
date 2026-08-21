import type { ColumnMeta, DateRange, Filter } from '../shared/schema/query';
import type { Grain } from '../shared/semantic/types';
import type { ReportDefinition } from '../shared/schema/report-definition';

/**
 * The gateway's HTTP surface, as the app sees it.
 *
 * These mirror the gateway's own return types. They are declared here rather than imported
 * from it because the app and the gateway are separately deployed artefacts that only agree
 * on JSON — writing the contract down on this side keeps that boundary explicit.
 */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export type Availability =
  | { state: 'available' }
  | { state: 'unavailable'; reason: string; missingMetrics: string[] }
  | { state: 'hidden' };

export type CatalogueEntry = Pick<
  ReportDefinition,
  | 'id'
  | 'version'
  | 'origin'
  | 'category'
  | 'titleKey'
  | 'title'
  | 'descriptionKey'
  | 'description'
  | 'audience'
  | 'defaults'
  | 'allowedFilters'
> & { availability: Availability };

export type CatalogueResponse = {
  reports: CatalogueEntry[];
  problems: Array<{ id: string; problem: string }>;
  registry: {
    sources: string[];
    invalid: Array<{ key: string; problem: string }>;
  };
};

export type Notice = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export type TileResult = {
  tileId: string;
  status: 'ok' | 'partial' | 'degraded' | 'unavailable';
  columns: ColumnMeta[];
  rows: Row[];
  totals: Record<string, Cell>;
  comparison?: { range: DateRange; rows: Row[]; totals: Record<string, Cell> };
  effectiveGrain: Grain | null;
  unavailableMetrics: Array<{ metric: string; reason: string }>;
  /** Which source served each metric, so a user can see where a number came from. */
  provenance: Array<{ metric: string; sourceId: string | null; rule: string }>;
  contributions: Array<{
    sourceId: string;
    metrics: string[];
    dataAsOf: string;
    status: string;
  }>;
  dataAsOf: string | null;
  notices: Notice[];
  cacheHit: boolean;
};

export type RunReportResponse = {
  reportId: string;
  reportVersion: number;
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  range: DateRange;
  compareRange: DateRange | null;
  grain: Grain;
  tiles: TileResult[];
  notices: Notice[];
  /** MIN across contributors — the honest "data as of", not the freshest. */
  dataAsOf: string | null;
  registrySources: string[];
};

export type RunReportRequest = {
  datePreset?: string;
  range?: DateRange;
  grain?: Grain;
  compare?: 'previousPeriod' | 'previousYear' | 'none';
  filters?: Filter[];
  timezone?: string;
  locale?: string;
};

export type DataSourceSummary = {
  sourceId: string;
  displayName: string;
  kind: string;
  demoMode: boolean;
  endpointUrl: string;
  connector: { name: string; version: string };
  capabilities: {
    metrics: Array<{ metricId: string; execution: string; grains: string[] }>;
    dimensions: Array<{ dimensionId: string; canonicalKeyDefinition?: string }>;
    timezone: string;
  };
  freshness: {
    mode: string;
    updateFrequency: string;
    typicalLagSeconds: number;
    restatementWindowDays: number;
  };
  scoping: { rowLevelDimensions: string[] };
};

export type DataSourcesResponse = {
  sources: DataSourceSummary[];
  invalid: Array<{ key: string; problem: string }>;
  loadedAt: string;
  timezoneDrift: {
    message: string;
    byTimezone: Record<string, string[]>;
  } | null;
};
