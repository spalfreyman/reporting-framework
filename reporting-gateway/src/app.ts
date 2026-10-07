import { Hono } from 'hono';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { correlationMiddleware } from './middleware/context.js';
import { errorHandler } from './middleware/error.js';
import { createRouter } from './routes/index.js';
import type { Env } from './http-context.js';

/**
 * The Hono app.
 *
 * The router is mounted at `/gateway`, matching `endpoint: /gateway` in connect.yaml. Connect
 * forwards traffic to `{url}/{endpoint}`, so if these two drift every request 404s.
 *
 * Hono rather than Express: the app is a thin HTTP shell around the planner/merge pipeline, and
 * Express drags `proxy-addr` (and `@commercetools-backend/express` drags Express again) into
 * the deployed tree, both of which Connect's software-composition analysis flags. Hono and its
 * Node adapter are dependency-free. Session verification is reimplemented directly on `jose` in
 * ./middleware/session.ts.
 */
export const createApp = (): Hono<Env> => {
  const app = new Hono<Env>();
  app.use('*', correlationMiddleware());
  app.route('/gateway', createRouter(createLogger(readConfiguration().LOG_LEVEL, { service: 'reporting-gateway' })));
  app.onError(errorHandler);
  return app;
};
