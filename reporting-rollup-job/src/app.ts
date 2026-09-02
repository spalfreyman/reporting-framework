import express, { type Express, type Request, type Response } from 'express';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { runJob, JOB_NAME } from './job.js';

/**
 * The job application. Mounted at /rollup-job to match connect.yaml.
 *
 * A Connect `job` is NOT a run-to-exit script: it is a long-running HTTP server that the
 * platform's scheduler triggers by POSTing to its endpoint on the cron schedule, and which
 * must reply 200. `/status` is an unauthenticated liveness probe used by the deploy health
 * check; a POST to the base path runs one rollup pass.
 *
 * runJob is lock-guarded and resumable, so an overlapping trigger is a safe no-op (it returns
 * `skipped`). We reply 200 in every non-crash case so a single slow run does not wedge the
 * scheduler into an endless redelivery loop; genuine startup/config failures still surface as
 * a 500.
 */
export const createApp = (): Express => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { app: JOB_NAME });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const base = '/rollup-job';

  app.get(`${base}/status`, (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', app: JOB_NAME });
  });

  app.post(base, async (_req: Request, res: Response) => {
    try {
      const result = await runJob();
      res.status(200).json({ ...result, app: JOB_NAME });
    } catch (error) {
      log.error('rollup job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'INTERNAL' });
    }
  });

  return app;
};
