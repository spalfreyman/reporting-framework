import express, { type Express, type Request, type Response } from 'express';
import { readConfiguration } from './env.js';
import { buildDescriptor } from './descriptor.js';
import { createQueryHandler } from './handler.js';
import { getCustomObjectPort } from './client.js';
import { createDspHandlers } from './shared/dsp/server.js';
import { TokenBucket } from './quota.js';

/**
 * The GA4 data source: the three DSP endpoints, mounted at the connect.yaml base path.
 * In demo mode no GA4 client or commercetools cache is touched at all.
 */
export const createApp = (): Express => {
  const config = readConfiguration();
  const descriptor = buildDescriptor();
  const bucket = new TokenBucket(config.GA4_TOKENS_PER_HOUR, config.GA4_TOKENS_PER_HOUR);

  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler({ port: getCustomObjectPort(), bucket }),
    health: async () => ({ mode: config.MODE, tokensAvailable: bucket.available }),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  const base = '/ga4-source';

  app.get(`${base}/health`, async (_req: Request, res: Response) => {
    const { status, body } = await handlers.health();
    res.status(status).json(body);
  });
  app.get(`${base}/describe`, async (req: Request, res: Response) => {
    const { status, body } = await handlers.describe(req.header('authorization'));
    res.status(status).json(body);
  });
  app.post(`${base}/query`, async (req: Request, res: Response) => {
    const { status, body } = await handlers.query(req.header('authorization'), req.body);
    res.status(status).json(body);
  });

  return app;
};
