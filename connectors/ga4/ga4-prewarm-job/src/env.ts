import { z } from 'zod';

const schema = z.object({
  CTP_PROJECT_KEY: z.string().min(1),
  CTP_REGION: z.string().min(1),
  CTP_CLIENT_ID: z.string().min(1),
  CTP_CLIENT_SECRET: z.string().min(1),
  CTP_SCOPE: z.string().min(1),
  SOURCE_ID: z.string().default('ga4'),
  GA4_SOURCE_URL: z.string().url().optional(),
  PREWARM_LOOKBACK_DAYS: z.coerce.number().int().positive().default(90),
  REPORTING_SHARED_SECRET: z.string().min(16),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type Config = z.infer<typeof schema> & { authUrl: string; apiUrl: string };
let cached: Config | undefined;
export const readConfiguration = (env: NodeJS.ProcessEnv = process.env): Config => {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
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
