import { DspFailure } from './shared/dsp/server.js';
import type { SourceQuery } from './shared/schema/query.js';
import { TEMPLATES, type SqlTemplate } from './sql/manifest.js';

/**
 * Compiles a SourceQuery into a whitelisted SQL statement with bound parameters.
 *
 * The safety guarantees, all enforced here BEFORE any SQL exists:
 *  - A template is chosen only if it declares every requested metric and dimension. No
 *    metric or dimension name from the request is ever concatenated into SQL.
 *  - Grouping columns come from the template's fixed `columnFor` allowlist, keyed by the
 *    (validated) dimension id — so an attacker-supplied dimension cannot become an
 *    identifier.
 *  - Values (dates, limit) are passed as bound parameters ($1..$3), never interpolated.
 *
 * There is deliberately no code path that turns request text into SQL text.
 */

export interface CompiledQuery {
  template: SqlTemplate;
  sql: string;
  params: Array<string | number>;
  /** Ordered output columns: date, then grouped dimensions, then metrics. */
  groupDimensions: string[];
  metrics: string[];
}

const chooseTemplate = (query: SourceQuery): SqlTemplate => {
  const groupDims = query.dimensions.filter((d) => d !== 'date');

  const covering = TEMPLATES.filter(
    (t) =>
      query.metrics.every((m) => t.metrics.includes(m)) &&
      groupDims.every((d) => t.dimensions.includes(d)) &&
      (query.grain === null || t.grains.includes(query.grain))
  );

  if (covering.length === 0) {
    throw new DspFailure(
      'UNSUPPORTED_METRIC',
      `No warehouse template serves ${query.metrics.join(', ')}` +
        (groupDims.length ? ` split by ${groupDims.join(', ')}` : '') +
        ` at ${query.grain ?? 'no'} grain`
    );
  }
  // Prefer the template that produces exactly the requested metrics (fewest extras).
  return covering.sort((a, b) => a.metrics.length - b.metrics.length)[0];
};

export const compileQuery = (query: SourceQuery, maxRows: number): CompiledQuery => {
  if (!query.timeRange) {
    throw new DspFailure('UNSUPPORTED_GRAIN', 'Warehouse queries need a time range.');
  }
  const template = chooseTemplate(query);
  const groupDims = query.dimensions.filter((d) => d !== 'date');

  // Map each requested dimension to its FIXED column via the allowlist. A dimension the
  // template does not know is rejected here — it can never reach the SQL as an identifier.
  const groupColumns = groupDims.map((d) => {
    const column = template.columnFor[d];
    if (!column) {
      throw new DspFailure('UNSUPPORTED_DIMENSION', `Warehouse cannot group by ${d}`);
    }
    return column;
  });

  // Half-open [from, to). The `to` bound is exclusive, so add nothing — the range already is.
  const params: Array<string | number> = [
    query.timeRange.from,
    query.timeRange.to,
    Math.min(query.limit, maxRows),
  ];

  return {
    template,
    sql: template.sql(groupColumns).trim(),
    params,
    groupDimensions: groupDims,
    metrics: query.metrics,
  };
};
