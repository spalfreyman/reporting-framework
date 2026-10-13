import {
  reportDefinitionSchema,
  type ReportDefinition,
  type ReportDefinitionInput,
} from '../schema/report-definition.js';

/**
 * The shipped report catalogue.
 *
 * Built-in reports live in CODE, not in Custom Objects: code-owned content stored as data
 * drifts, and needs a data migration for what should be a deploy. User-created reports and
 * per-role overlays live in Custom Objects instead.
 *
 * They are plain TS modules rather than imported JSON, so there is no dependency on import
 * attributes or a bundler's JSON handling — this package gets copied into a webpack-built
 * MC app and several Node services, and all of them must agree.
 *
 * Every definition is parsed through the schema at module load, so a malformed built-in
 * fails fast at startup rather than when someone opens the report.
 */
import { catalogueHealth } from './catalogue-health.report.js';
import { cohortRetention } from './cohort-retention.report.js';
import { conversionFunnel } from './conversion-funnel.report.js';
import { deviceGeography } from './device-geography.report.js';
import { fulfilmentSla } from './fulfilment-sla.report.js';
import { marginErosion } from './margin-erosion.report.js';
import { newVsReturning } from './new-vs-returning.report.js';
import { priceArchitecture } from './price-architecture.report.js';
import { productPerformance } from './product-performance.report.js';
import { promotionEffectiveness } from './promotion-effectiveness.report.js';
import { returnsAnalysis } from './returns-analysis.report.js';
import { salesByCategory } from './sales-by-category.report.js';
import { salesByChannel } from './sales-by-channel.report.js';
import { stockCover } from './stock-cover.report.js';
import { tradingDashboard } from './trading-dashboard.report.js';

const raw: ReportDefinitionInput[] = [
  tradingDashboard,
  catalogueHealth,
  salesByChannel,
  salesByCategory,
  productPerformance,
  priceArchitecture,
  newVsReturning,
  cohortRetention,
  conversionFunnel,
  deviceGeography,
  marginErosion,
  promotionEffectiveness,
  fulfilmentSla,
  returnsAnalysis,
  stockCover,
];

export const BUILTIN_REPORTS: Readonly<Record<string, ReportDefinition>> = Object.freeze(
  Object.fromEntries(
    raw.map((entry) => {
      const parsed = reportDefinitionSchema.parse(entry);
      return [parsed.id, Object.freeze(parsed)];
    })
  )
);

export const builtinReportIds = (): string[] => Object.keys(BUILTIN_REPORTS);
