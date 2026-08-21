import { z } from 'zod';

const schema = z
  .object({
    CTP_PROJECT_KEY: z.string().min(1),
    CTP_REGION: z.string().min(1),
    CTP_CLIENT_ID: z.string().min(1),
    CTP_CLIENT_SECRET: z.string().min(1),
    CTP_SCOPE: z.string().min(1),
    SOURCE_ID: z.string().regex(/^[a-z0-9-]+$/).default('erp-oms'),
    SOURCE_DISPLAY_NAME: z.string().default('ERP / OMS'),
    MODE: z.enum(['live', 'demo']).default('demo'),
    ERP_BASE_URL: z.string().url().optional(),
    ERP_AUTH_MODE: z.enum(['apiKey', 'basic', 'none']).default('apiKey'),
    ERP_API_KEY: z.string().optional(),
    ERP_TIMEZONE: z.string().default('UTC'),
    ERP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    CONNECT_SERVICE_URL: z.string().url().optional(),
    REPORTING_SHARED_SECRET: z.string().min(16),
    PORT: z.coerce.number().int().positive().default(8086),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .refine((c) => c.MODE !== 'live' || c.ERP_BASE_URL, {
    message: 'MODE=live requires ERP_BASE_URL',
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
