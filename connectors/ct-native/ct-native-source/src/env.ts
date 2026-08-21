import { z } from 'zod';

/** Fail-fast configuration, validated once at startup. */
const schema = z.object({
  CTP_PROJECT_KEY: z.string().min(1),
  CTP_REGION: z.string().min(1),
  CTP_CLIENT_ID: z.string().min(1),
  CTP_CLIENT_SECRET: z.string().min(1),
  CTP_SCOPE: z.string().min(1),

  SOURCE_ID: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'must be lowercase letters, digits and hyphens')
    .default('ct-native'),
  SOURCE_DISPLAY_NAME: z.string().default('commercetools'),
  MODE: z.enum(['live', 'demo']).default('live'),

  /**
   * The timezone the rollup cut its day buckets in. It MUST match the framework's
   * ROLLUP_TIMEZONE: if it does not, the descriptor advertises the wrong thing and
   * cross-source day-grain joins are silently misaligned.
   */
  ROLLUP_TIMEZONE: z.string().default('UTC'),

  PRICE_BANDS: z
    .string()
    .default('[1000,5000,20000,100000]')
    .transform((raw, ctx) => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== 'number')) {
          throw new Error('expected an array of numbers');
        }
        return (parsed as number[]).slice().sort((a, b) => a - b);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `PRICE_BANDS must be a JSON array of minor-unit numbers: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        return z.NEVER;
      }
    }),

  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(600),
  CONNECT_SERVICE_URL: z.string().url().optional(),
  REPORTING_SHARED_SECRET: z.string().min(16),

  PORT: z.coerce.number().int().positive().default(8080),
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
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
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
