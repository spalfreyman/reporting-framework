import express, { type Express, type Request, type Response } from 'express';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { processDelivery } from './handler.js';
import { getApiRoot, getCustomObjectPort } from './client.js';

/**
 * The event application. Mounted at /rollup-event to match connect.yaml.
 *
 * Connect delivers Subscription messages here. `/status` is unauthenticated for liveness; the
 * delivery route optionally checks EVENT_SECRET when one is configured.
 */
export const createApp = (): Express => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { app: 'reporting-rollup-event' });
  const apiRoot = getApiRoot();
  const port = getCustomObjectPort();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const base = '/rollup-event';

  app.get(`${base}/status`, (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', app: 'reporting-rollup-event' });
  });

  app.post(base, async (req: Request, res: Response) => {
    if (config.EVENT_SECRET) {
      const header = req.header('authorization')?.replace(/^Bearer\s+/i, '');
      if (header !== config.EVENT_SECRET) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
      }
    }
    try {
      const { status, outcome } = await processDelivery(req.body, { port, apiRoot, log });
      res.status(status).json({ outcome });
    } catch (error) {
      // A genuine transient failure: do NOT ack, so the platform redelivers.
      log.error('delivery processing failed; not acking', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'INTERNAL' });
    }
  });

  return app;
};
