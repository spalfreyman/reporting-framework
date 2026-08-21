import express, { type Express, type Request, type Response } from 'express';
import { readConfiguration } from './env.js';
import { buildDescriptor } from './descriptor.js';
import { createQueryHandler } from './handler.js';
import { getApiRoot, getCustomObjectPort } from './ct/client.js';
import { createDspHandlers } from './shared/dsp/server.js';

/**
 * The three Data Source Provider endpoints.
 *
 * Mounted at the same base path as `endpoint` in connect.yaml — Connect forwards traffic to
 * `{url}/{endpoint}`, so if the two drift every request 404s.
 *
 * `/health` is unauthenticated so a liveness probe works; `/describe` and `/query` require
 * the shared secret, compared in constant time.
 */
export const createApp = (options: { descriptor?: ReturnType<typeof buildDescriptor> } = {}): Express => {
  const config = readConfiguration();

  // Built once. In demo mode the SDK client is never constructed, so the connector runs
  // with no reachable commercetools project at all. In live mode index.ts probes Product
  // Search first and passes a descriptor that reflects what this project can actually serve.
  const descriptor = options.descriptor ?? buildDescriptor();

  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler({ apiRoot: getApiRoot, port: getCustomObjectPort }),
    health: async () => ({ mode: config.MODE, timezone: config.ROLLUP_TIMEZONE }),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const base = '/ct-native-source';

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
