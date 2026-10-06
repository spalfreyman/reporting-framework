import express, { type Express, type Request, type Response } from 'express';
import { runPrewarm, JOB_NAME } from './job.js';

/**
 * The job application. Mounted at /__SOURCE_ID__-prewarm-job to match connect.yaml.
 *
 * A Connect `job` is NOT a run-to-exit script: the scheduler triggers it by POSTing to its
 * endpoint on the cron schedule, and it must pass a liveness probe and reply 200. `/status`
 * is the probe; a POST to the base path runs one pass. We reply 200 on every non-crash so a
 * single slow run does not wedge the scheduler into an endless redelivery loop.
 */
export const createApp = (): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const base = '/__SOURCE_ID__-prewarm-job';

  app.get(`${base}/status`, (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', app: JOB_NAME });
  });

  app.post(base, async (_req: Request, res: Response) => {
    try {
      const result = await runPrewarm();
      res.status(200).json({ ...result, app: JOB_NAME });
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          level: 'error',
          message: 'pre-warm failed',
          app: JOB_NAME,
          error: error instanceof Error ? error.message : String(error),
        })}\n`
      );
      res.status(500).json({ error: 'INTERNAL' });
    }
  });

  return app;
};
