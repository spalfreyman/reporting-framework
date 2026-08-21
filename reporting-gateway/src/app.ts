import express, { type Express } from 'express';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { correlationMiddleware } from './middleware/context.js';
import { errorMiddleware } from './middleware/error.js';
import { createRouter } from './routes/index.js';

/**
 * The Express app.
 *
 * The router is mounted at `/gateway`, matching `endpoint: /gateway` in connect.yaml.
 * Connect forwards traffic to `{url}/{endpoint}`, so if these two drift every request 404s.
 */
export const createApp = (): Express => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { service: 'reporting-gateway' });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware());
  app.use('/gateway', createRouter(log));
  app.use(errorMiddleware());

  return app;
};
