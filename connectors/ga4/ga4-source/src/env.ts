import { z } from 'zod';

/** Fail-fast configuration, validated once at startup. */
const schema = z
  .object({
    CTP_PROJECT_KEY: z.string().min(1),
    CTP_REGION: z.string().min(1),
    CTP_CLIENT_ID: z.string().min(1),
    CTP_CLIENT_SECRET: z.string().min(1),
    CTP_SCOPE: z.string().min(1),

    SOURCE_ID: z.string().regex(/^[a-z0-9-]+$/).default('ga4'),
    SOURCE_DISPLAY_NAME: z.string().default('Google Analytics 4'),
    MODE: z.enum(['live', 'demo']).default('demo'),

    GA4_PROPERTY_ID: z.string().optional(),
    GA4_TIMEZONE: z.string().default('UTC'),
    GA4_SERVICE_ACCOUNT_JSON: z.string().optional(),
    GA4_TOKENS_PER_HOUR: z.coerce.number().int().positive().default(1000),

    CACHE_TTL_SEALED_SECONDS: z.coerce.number().int().nonnegative().default(21_600),
    CACHE_TTL_TODAY_SECONDS: z.coerce.number().int().nonnegative().default(900),

    CONNECT_SERVICE_URL: z.string().url().optional(),
    REPORTING_SHARED_SECRET: z.string().min(16),
    PORT: z.coerce.number().int().positive().default(8084),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .refine((c) => c.MODE !== 'live' || (c.GA4_PROPERTY_ID && c.GA4_SERVICE_ACCOUNT_JSON), {
    message: 'MODE=live requires GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON',
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
