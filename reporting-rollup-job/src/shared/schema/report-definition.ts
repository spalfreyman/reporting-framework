import { z } from 'zod';
import { chartSpecSchema } from './chart-spec.js';
import { filterSchema, grainSchema } from './query.js';

/** Relative date presets are stored as the preset id, so a shared link stays relative. */
export const DATE_PRESETS = [
  'today',
  'yesterday',
  'last7d',
  'last28d',
  'last90d',
  'wtd',
  'mtd',
  'qtd',
  'ytd',
  'custom',
] as const;

export const comparisonSchema = z.object({
  kind: z.enum(['previousPeriod', 'previousYear', 'none']),
  /** Align by weekday index, not literal date, or week-over-week compares Mon to Sun. */
  alignBy: z.enum(['weekday', 'date']).default('weekday'),
});

/**
 * FX policy. With mode 'none' and multiple currencies present, per-currency rows are
 * returned and the totals row is null. Converted values are ADDITIONAL measures carrying
 * the rate-set key in provenance; the native-currency measure is never mutated, because
 * finance will re-run last quarter and expect the same number.
 */
export const fxPolicySchema = z.object({
  mode: z.enum(['none', 'reportCurrency']).default('none'),
  reportCurrency: z.string().optional(),
  rateSetKey: z.string().optional(),
  rateDate: z.enum(['transactionDate', 'periodEnd', 'fixed']).default('transactionDate'),
  fixedDate: z.string().optional(),
});

export const tileSchema = z.object({
  id: z.string().min(1),
  titleKey: z.string().optional(),
  title: z.record(z.string()).optional(),
  /** 12-column grid. */
  span: z.number().int().min(1).max(12),
  query: z.object({
    metrics: z.array(z.string()).min(1),
    dimensions: z.array(z.string()).default([]),
    grain: z.union([grainSchema, z.literal('inherit')]).default('inherit'),
    filters: z.array(filterSchema).default([]),
    topN: z
      .object({ by: z.string(), n: z.number().int().positive(), otherBucket: z.boolean().default(false) })
      .optional(),
    orderBy: z
      .array(z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }))
      .default([]),
    having: z
      .array(z.object({ metric: z.string(), op: z.enum(['gt', 'gte', 'lt', 'lte']), value: z.number() }))
      .default([]),
    limit: z.number().int().positive().optional(),
    comparison: z.enum(['inherit', 'none']).default('inherit'),
    /** Point-in-time snapshot (live catalogue tiles). */
    pointInTime: z.boolean().default(false),
    /** Coarsen the whole tile, drop the metric, or split it out. Never interpolate. */
    onGrainMismatch: z.enum(['coarsen', 'omit', 'split']).default('coarsen'),
    /** Pin a source for these metrics, overriding the planner's comparator. */
    preferredSource: z.string().optional(),
  }),
  chart: chartSpecSchema,
  emptyStateKey: z.string().optional(),
  /** Tile is hidden with a notice when these sources are absent. */
  requiresSources: z.array(z.string()).default([]),
  drilldown: z
    .object({ toReportId: z.string().optional(), addDimensions: z.array(z.string()).default([]) })
    .optional(),
});
export type Tile = z.infer<typeof tileSchema>;

export const reportDefinitionSchema = z.object({
  /** SHAPE version. Bumping this requires a migration function. */
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  /** CONTENT revision, bumped on every edit. */
  version: z.number().int().positive().default(1),
  origin: z.enum(['builtin', 'custom']),
  titleKey: z.string().optional(),
  title: z.record(z.string()).optional(),
  descriptionKey: z.string().optional(),
  description: z.record(z.string()).optional(),
  category: z.enum([
    'trading',
    'merchandising',
    'customer',
    'marketing',
    'promotions',
    'operations',
    'inventory',
  ]),
  /** Roles this report is framed for. Drives the catalogue's role filter. */
  audience: z.array(z.string()).default([]),

  requiredCapabilities: z.object({
    /** Report is unavailable if any of these cannot be served. */
    metrics: z.array(z.string()).default([]),
    sourceKinds: z.array(z.string()).default([]),
    /** MC permission names required to see the report at all. */
    permissions: z.array(z.string()).default([]),
  }),
  optionalMetrics: z.array(z.string()).default([]),
  /** 'strict' fails the report on partial data — right for a catalogue count. */
  failurePolicy: z.enum(['lenient', 'strict']).default('lenient'),

  defaults: z.object({
    datePreset: z.enum(DATE_PRESETS).default('last28d'),
    grain: grainSchema.default('day'),
    timezone: z.union([z.literal('project'), z.string()]).default('project'),
    weekStart: z.enum(['monday', 'sunday']).default('monday'),
    comparison: comparisonSchema.default({ kind: 'previousPeriod', alignBy: 'weekday' }),
    fx: fxPolicySchema.default({ mode: 'none', rateDate: 'transactionDate' }),
    filters: z.array(filterSchema).default([]),
  }),

  allowedFilters: z
    .array(
      z.object({
        dimension: z.string(),
        ops: z.array(z.enum(['in', 'notIn', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'contains'])),
        multi: z.boolean().default(true),
        required: z.boolean().default(false),
        valueSource: z
          .enum(['ct-stores', 'ct-channels', 'ct-categories', 'ct-customer-groups', 'static', 'dsp'])
          .default('dsp'),
        staticValues: z.array(z.object({ value: z.string(), labelKey: z.string() })).default([]),
      })
    )
    .default([]),

  freshness: z
    .object({
      maxAcceptableLagSeconds: z.number().int().positive().optional(),
      showAsOf: z.boolean().default(true),
    })
    .default({ showAsOf: true }),

  layout: z.object({ rows: z.array(z.object({ id: z.string(), tileIds: z.array(z.string()) })) }),
  tiles: z.array(tileSchema).min(1),
  export: z
    .object({ csv: z.boolean().default(true), maxRows: z.number().int().positive().default(50000) })
    .default({ csv: true, maxRows: 50000 }),
});
/** Parsed/normalised form: every defaulted field is present. What the runtime consumes. */
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

/**
 * Authoring form: defaulted fields are optional. Built-in report literals are typed
 * against this, then parsed into a ReportDefinition at load.
 */
export type ReportDefinitionInput = z.input<typeof reportDefinitionSchema>;

export const CURRENT_REPORT_SCHEMA_VERSION = 1;

/**
 * Migrations are applied LAZILY on read, so old stored definitions keep working.
 * A schemaVersion greater than CURRENT means "update the connector" — never guess forward.
 */
export const migrations: Record<number, (input: Record<string, unknown>) => Record<string, unknown>> = {
  // 1 -> 2 goes here when the shape first changes.
};

export const migrateReportDefinition = (input: Record<string, unknown>): Record<string, unknown> => {
  let current = input;
  let version = Number(current.schemaVersion ?? 1);
  if (version > CURRENT_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Report "${String(current.id)}" has schemaVersion ${version}, newer than this build ` +
        `supports (${CURRENT_REPORT_SCHEMA_VERSION}). Update the reporting connector.`
    );
  }
  while (version < CURRENT_REPORT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`No migration from report schemaVersion ${version}`);
    current = migrate(current);
    version = Number(current.schemaVersion ?? version + 1);
  }
  return current;
};
