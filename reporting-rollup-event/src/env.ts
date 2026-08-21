import { z } from 'zod';

const schema = z.object({
  CTP_PROJECT_KEY: z.string().min(1),
  CTP_REGION: z.string().min(1),
  CTP_CLIENT_ID: z.string().min(1),
  CTP_CLIENT_SECRET: z.string().min(1),
  CTP_SCOPE: z.string().min(1),
  ROLLUP_TIMEZONE: z.string().default('UTC'),
  SUBSCRIPTION_KEY: z.string().default('reporting-rollup-event'),
  /**
   * Optional shared secret. Connect delivers Subscription messages over its own managed
   * transport, so this is belt-and-braces for setups that expose the endpoint directly.
   */
  EVENT_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8082),
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
