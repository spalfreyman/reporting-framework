import { z } from 'zod';

/**
 * Fail-fast configuration.
 *
 * Connect apps are stateless and all config arrives as env vars, so it is validated ONCE at
 * startup and throws on anything invalid. The alternative — `process.env.X!` deep in a
 * handler — turns a bad deploy into a cryptic 500 in production instead of a failed boot.
 */

const schema = z.object({
  CTP_PROJECT_KEY: z.string().min(1),
  CTP_REGION: z.string().min(1),
  CTP_CLIENT_ID: z.string().min(1),
  CTP_CLIENT_SECRET: z.string().min(1),
  CTP_SCOPE: z.string().min(1),

  CLOUD_IDENTIFIER: z.enum(['gcp-eu', 'gcp-us', 'aws-eu', 'aws-us', 'gcp-au']).default('gcp-eu'),

  /**
   * Injected by Connect. The JWT audience is derived from its ORIGIN, which must match the
   * `forward-url-origin` audience policy the Merchant Center app sends.
   */
  CONNECT_SERVICE_URL: z.string().url(),

  REPORTING_SHARED_SECRET: z.string().min(16, 'must be at least 16 characters'),
  REPORTING_REQUIRED_PERMISSION: z.string().default('ViewReporting'),

  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  MAX_SOURCE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  CACHE_TTL_TODAY_SECONDS: z.coerce.number().int().nonnegative().default(300),
  CACHE_TTL_SEALED_SECONDS: z.coerce.number().int().nonnegative().default(604_800),

  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema> & {
  /** Origin-only form of CONNECT_SERVICE_URL, which is what the JWT audience must be. */
  sessionAudience: string;
  authUrl: string;
  apiUrl: string;
};

let cached: Config | undefined;

export const readConfiguration = (env: NodeJS.ProcessEnv = process.env): Config => {
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }

  const value = parsed.data;
  cached = {
    ...value,
    sessionAudience: new URL(value.CONNECT_SERVICE_URL).origin,
    authUrl: `https://auth.${value.CTP_REGION}.commercetools.com`,
    apiUrl: `https://api.${value.CTP_REGION}.commercetools.com`,
  };
  return cached;
};

/** Test-only: clears the memoised config. */
export const resetConfiguration = (): void => {
  cached = undefined;
};
