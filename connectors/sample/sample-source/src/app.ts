import express, { type Express, type Request, type Response } from 'express';
import { readConfiguration } from './env.js';
import { buildDescriptor } from './descriptor.js';
import { createQueryHandler } from './handler.js';
import { createDspHandlers } from './shared/dsp/server.js';

/**
 * The data source's HTTP surface: the three DSP endpoints, mounted at the connect.yaml base
 * path. `/health` is unauthenticated liveness; `/describe` and `/query` require the shared
 * secret. The harness in shared/dsp/server.ts carries auth, validation and error shaping so
 * this file stays tiny.
 */
export const createApp = (): Express => {
  const config = readConfiguration();
  const descriptor = buildDescriptor();

  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler(),
    health: async () => ({ demoMode: descriptor.demoMode }),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  const base = '/sample-source';

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
