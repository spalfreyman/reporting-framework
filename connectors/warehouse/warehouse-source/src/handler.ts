import { readConfiguration } from './env.js';
import { buildResultSet, type DspHandlerContext } from './shared/dsp/server.js';
import { getMetric } from './shared/semantic/metrics.js';
import type { ColumnMeta, ResultSet } from './shared/schema/query.js';
import { compileQuery } from './compile-query.js';
import { buildDemoRows } from './demo-data.js';
import { runPostgres } from './adapters/postgres.js';
import { runUnsupported } from './adapters/unsupported.js';

/**
 * The warehouse query handler.
 *
 * Both modes compile the SAME whitelisted, parameterised query first — so a request that
 * cannot be expressed as a safe template is rejected before either path runs. Live executes
 * it against the warehouse driver; demo satisfies it from the shared generator.
 */
export const createQueryHandler =
  () =>
  async ({ query, descriptor }: DspHandlerContext): Promise<ResultSet> => {
    const config = readConfiguration();
    const compiled = compileQuery(query, config.MAX_ROWS);

    if (config.MODE === 'demo') {
      const { columns, rows } = buildDemoRows(query, compiled);
      return buildResultSet({
        descriptor,
        columns,
        rows,
        execution: 'materialized',
        dataAsOf: new Date().toISOString(),
        grainServed: 'day',
        degradedReason: 'demo-fixture',
        detail: 'Demo mode: warehouse figures are generated, not real.',
      });
    }

    // Live: run the compiled statement against the configured driver.
    const rawRows =
      config.WAREHOUSE_KIND === 'postgres'
        ? await runPostgres(config.PG_CONNECTION_STRING as string, compiled, config.QUERY_TIMEOUT_MS)
        : runUnsupported(config.WAREHOUSE_KIND);

    const includeDate = query.dimensions.includes('date') || query.grain !== null;
    const columns: ColumnMeta[] = [
      ...(includeDate ? [{ id: 'date', role: 'time' as const, valueType: 'time' as const, exactness: 'exact' as const, nullMeaning: 'zero' as const }] : []),
      ...compiled.groupDimensions.map((id) => ({ id, role: 'dimension' as const, valueType: 'string' as const, exactness: 'exact' as const, nullMeaning: 'unknown' as const })),
      ...compiled.metrics.map((id) => ({
        id,
        role: 'metric' as const,
        valueType: getMetric(id)?.valueType ?? ('count' as const),
        exactness: 'exact' as const,
        nullMeaning: 'zero' as const,
      })),
    ];

    const rows = rawRows.map((row) => [
      ...(includeDate ? [row.day ?? null] : []),
      ...compiled.groupDimensions.map((id) => row[compiled.template.columnFor[id]] ?? null),
      ...compiled.metrics.map((id) => {
        const v = row[id];
        return typeof v === 'number' ? v : v === null || v === undefined ? null : Number(v);
      }),
    ]);

    return buildResultSet({
      descriptor,
      columns,
      rows,
      execution: 'materialized',
      dataAsOf: new Date().toISOString(),
      grainServed: 'day',
      ...(rows.length >= config.MAX_ROWS ? { partial: true, degradedReason: 'limit-truncated' as const } : {}),
    });
  };
