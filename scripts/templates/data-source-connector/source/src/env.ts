import { z } from 'zod';

/**
 * Fail-fast configuration, validated once at startup.
 *
 * A data-source connector needs commercetools credentials only to (a) self-register its
 * descriptor in postDeploy and (b) withdraw it in preUndeploy. This sample generates its
 * data locally, so the query path itself needs no upstream credentials at all.
 */
const schema = z.object({
  CTP_PROJECT_KEY: z.string().min(1),
  CTP_REGION: z.string().min(1),
  CTP_CLIENT_ID: z.string().min(1),
  CTP_CLIENT_SECRET: z.string().min(1),
  CTP_SCOPE: z.string().min(1),

  SOURCE_ID: z.string().regex(/^[a-z0-9-]+$/).default('__SOURCE_ID__'),
  SOURCE_DISPLAY_NAME: z.string().default('__DISPLAY_NAME__'),
  SOURCE_TIMEZONE: z.string().default('UTC'),
  /** Deterministic seed so the synthetic figures are stable across restarts. */
  DATA_SEED: z.coerce.number().int().default(42),

  CONNECT_SERVICE_URL: z.string().url().optional(),
  REPORTING_SHARED_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(__SOURCE_PORT__),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema> & { authUrl: string; apiUrl: string };

let cached: Config | undefined;
export const readConfiguration = (env: NodeJS.ProcessEnv = process.env): Config => {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  cached = {
    ...parsed.data,
    authUrl: `https://auth.${parsed.data.CTP_REGION}.commercetools.com`,
    apiUrl: `https://api.${parsed.data.CTP_REGION}.commercetools.com`,
  };
  return cached;
};
export const resetConfiguration = (): void => {
  cached = undefined;
};
