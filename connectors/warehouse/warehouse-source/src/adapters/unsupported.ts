import { DspFailure } from '../shared/dsp/server.js';

/**
 * BigQuery and Snowflake share the exact same compiled-query contract as Postgres; only the
 * driver differs. They are declared but not implemented here, and say so honestly rather
 * than pretending — a `CAPABILITY_NOT_IMPLEMENTED` is far better than a silent wrong answer.
 */
export const runUnsupported = (kind: string): never => {
  throw new DspFailure(
    'CAPABILITY_NOT_IMPLEMENTED',
    `WAREHOUSE_KIND=${kind} is not implemented in this connector. Use postgres, or extend ` +
      `src/adapters with a driver that runs the same compiled, parameterised query.`,
    { status: 501 }
  );
};
