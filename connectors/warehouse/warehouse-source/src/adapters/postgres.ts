import type { CompiledQuery } from '../compile-query.js';

/**
 * The Postgres adapter. Runs the compiled, parameterised statement — values are bound by the
 * driver, never string-formatted.
 *
 * `pg` is loaded lazily so demo-mode installs need not depend on it; a live install adds it.
 */
export interface WarehouseRow {
  [column: string]: string | number | null;
}

export const runPostgres = async (
  connectionString: string,
  compiled: CompiledQuery,
  timeoutMs: number
): Promise<WarehouseRow[]> => {
  let Client: new (config: { connectionString: string; statement_timeout: number }) => {
    connect: () => Promise<void>;
    query: (text: string, params: unknown[]) => Promise<{ rows: WarehouseRow[] }>;
    end: () => Promise<void>;
  };
  try {
    // Indirect specifier: keeps TS from requiring @types/pg for a dependency that is
    // only present in a live Postgres install.
    const moduleName = 'pg';
    ({ Client } = (await import(moduleName)) as unknown as { Client: typeof Client });
  } catch {
    throw new Error('The "pg" package is required for WAREHOUSE_KIND=postgres in live mode.');
  }

  const client = new Client({ connectionString, statement_timeout: timeoutMs });
  await client.connect();
  try {
    const result = await client.query(compiled.sql, compiled.params);
    return result.rows;
  } finally {
    await client.end();
  }
};
