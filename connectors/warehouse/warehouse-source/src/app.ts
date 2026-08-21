import express, { type Express, type Request, type Response } from 'express';
import { readConfiguration } from './env.js';
import { buildDescriptor } from './descriptor.js';
import { createQueryHandler } from './handler.js';
import { createDspHandlers } from './shared/dsp/server.js';

export const createApp = (): Express => {
  const config = readConfiguration();
  const descriptor = buildDescriptor();
  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler(),
    health: async () => ({ mode: config.MODE, kind: config.WAREHOUSE_KIND }),
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  const base = '/warehouse-source';
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
