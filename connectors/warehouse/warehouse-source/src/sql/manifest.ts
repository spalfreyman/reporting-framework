import type { Grain } from '../shared/semantic/types.js';

/**
 * The SQL template whitelist.
 *
 * This is the connector's security spine. The client NEVER sends SQL. Each template is a
 * fixed, parameterised statement; a request is mapped onto one of these by name, and the
 * only things that vary are BOUND PARAMETERS ($1, $2, …). Metric and dimension names are
 * validated against the `metrics`/`dimensions` a template declares before anything runs, so
 * a name can never reach an identifier position in the SQL.
 *
 * Adding a capability means adding a template here — reviewed, parameterised — not accepting
 * a fragment from the caller.
 */

export interface SqlTemplate {
  name: string;
  /** Semantic metric ids this template can produce. */
  metrics: string[];
  /** Semantic dimension ids this template can group by (beyond the mandatory date). */
  dimensions: string[];
  grains: Grain[];
  /**
   * Parameterised SQL. `$1` = from date, `$2` = to date (half-open), `$3` = limit.
   * Grouping columns are chosen from a FIXED allowlist keyed by dimension id, never
   * interpolated from the request.
   */
  sql: (groupByColumns: string[]) => string;
  /** Maps a semantic dimension id to its fixed warehouse column name. Allowlist only. */
  columnFor: Record<string, string>;
}

// Fixed dimension→column allowlist. A dimension not present here cannot be grouped by,
// which is what the compiler checks before building any SQL.
const DIMENSION_COLUMNS: Record<string, string> = {
  date: 'day',
  currency: 'currency_code',
  store: 'store_key',
  category: 'category_key',
  product: 'sku',
  campaign: 'campaign',
  channel: 'channel',
};

const groupExpr = (cols: string[]): string => (cols.length ? `, ${cols.join(', ')}` : '');
const groupBy = (cols: string[]): string => (cols.length ? `, ${cols.join(', ')}` : '');

export const TEMPLATES: SqlTemplate[] = [
  {
    name: 'cost_and_margin',
    metrics: ['cost.goods@orderdate', 'revenue.net@orderdate', 'units.sold@orderdate'],
    dimensions: ['currency', 'store', 'category', 'product'],
    grains: ['day', 'week', 'month', 'quarter', 'year'],
    columnFor: DIMENSION_COLUMNS,
    sql: (cols) => `
      SELECT day${groupExpr(cols)},
             SUM(unit_cost * units)::bigint AS "cost.goods@orderdate",
             SUM(revenue_net)::bigint       AS "revenue.net@orderdate",
             SUM(units)::bigint             AS "units.sold@orderdate"
      FROM reporting_order_lines
      WHERE day >= $1 AND day < $2
      GROUP BY day${groupBy(cols)}
      ORDER BY day
      LIMIT $3`,
  },
  {
    name: 'marketing_spend',
    metrics: ['marketing.spend'],
    dimensions: ['currency', 'campaign', 'channel'],
    grains: ['day', 'week', 'month', 'quarter', 'year'],
    columnFor: DIMENSION_COLUMNS,
    sql: (cols) => `
      SELECT day${groupExpr(cols)},
             SUM(spend)::bigint AS "marketing.spend"
      FROM reporting_marketing_spend
      WHERE day >= $1 AND day < $2
      GROUP BY day${groupBy(cols)}
      ORDER BY day
      LIMIT $3`,
  },
];

export const templateByName = (name: string): SqlTemplate | undefined =>
  TEMPLATES.find((t) => t.name === name);
