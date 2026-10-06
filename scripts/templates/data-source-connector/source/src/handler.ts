import { buildResultSet, type DspHandlerContext, type DspQueryHandler } from './shared/dsp/server.js';
import type { ResultSet } from './shared/schema/query.js';
import { generateRows } from './data.js';

/**
 * The query handler.
 *
 * The DSP harness has already authenticated the request, validated it against the descriptor
 * (metrics/dimensions/grains/filters/scope), and parsed it — so here you just produce rows.
 * Swap generateRows() for a real upstream call to turn this sample into a real connector;
 * everything else (auth, validation, error shaping, result envelope) stays identical.
 */
export const createQueryHandler = (): DspQueryHandler => {
  return async ({ query, descriptor }: DspHandlerContext): Promise<ResultSet> => {
    const { columns, rows, truncated } = generateRows(query);
    return buildResultSet({
      descriptor,
      columns,
      rows,
      execution: 'materialized',
      dataAsOf: new Date().toISOString(),
      grainServed: query.grain,
      partial: truncated > 0,
      ...(truncated > 0
        ? { degradedReason: 'limit-truncated' as const, detail: `limit hit; ${truncated} rows dropped`, rowsTruncated: truncated }
        : {}),
    });
  };
};
