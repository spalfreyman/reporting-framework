import { z } from 'zod';

const schema = z.object({
  CTP_PROJECT_KEY: z.string().min(1),
  CTP_REGION: z.string().min(1),
  CTP_CLIENT_ID: z.string().min(1),
  CTP_CLIENT_SECRET: z.string().min(1),
  CTP_SCOPE: z.string().min(1),

  ROLLUP_TIMEZONE: z.string().default('UTC'),
  ROLLUP_CUBES: z.string().default('orders-daily,order-lines-daily'),
  /** Wall-clock budget before checkpointing and exiting 0. Job hard timeout is 30 min. */
  ROLLUP_BUDGET_MS: z.coerce.number().int().positive().default(1_200_000),
  /** Lock TTL. MUST exceed the 30-min timeout so a crashed run's lock expires. */
  ROLLUP_LOCK_TTL_MS: z.coerce.number().int().positive().default(2_700_000),
  ROLLUP_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(100),
  RESTATEMENT_WINDOW_DAYS: z.coerce.number().int().nonnegative().default(90),
  BACKFILL_DAYS: z.coerce.number().int().positive().default(400),
  /**
   * Seconds to hold back from 'now' when scanning, so a write still settling is not
   * skipped. 120 is right for live runs; set 0 for a one-off backfill of data you know
   * is already settled (e.g. imported historical orders).
   */
  ROLLUP_SAFE_LAG_SECONDS: z.coerce.number().int().nonnegative().default(120),
  /** Top-N SKUs per store per day kept in order-lines-daily; the tail folds to __other__. */
  ITEM_TOP_N: z.coerce.number().int().positive().default(500),

  /**
   * Port the job's HTTP server listens on. A Connect `job` is a long-running server the
   * scheduler POSTs to on its cron; Connect injects PORT at runtime. The default is only for
   * local `dev`/`start`.
   */
  PORT: z.coerce.number().int().positive().default(8083),
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
