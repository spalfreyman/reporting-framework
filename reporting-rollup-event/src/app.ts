import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { processDelivery } from './handler.js';
import { getApiRoot, getCustomObjectPort } from './client.js';

/**
 * The event application. Mounted at /rollup-event to match connect.yaml.
 *
 * Connect delivers Subscription messages here. `/status` is unauthenticated for liveness; the
 * delivery route optionally checks EVENT_SECRET when one is configured.
 *
 * Implemented on Node's built-in `http` server rather than a framework: the app has two routes
 * and a single JSON body to parse, so a web framework would be pure cost — and keeping it out
 * leaves the deployed tree free of the transitive packages Connect's SCA flags.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2mb, matching the previous express json limit.

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Reads and JSON-parses the request body, rejecting anything over the size limit. */
const readJsonBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

export const createApp = (): Server => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { app: 'reporting-rollup-event' });
  const apiRoot = getApiRoot();
  const port = getCustomObjectPort();
  const base = '/rollup-event';

  return createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];

    if (req.method === 'GET' && path === `${base}/status`) {
      sendJson(res, 200, { status: 'ok', app: 'reporting-rollup-event' });
      return;
    }

    if (req.method === 'POST' && path === base) {
      if (config.EVENT_SECRET) {
        const header = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
        if (header !== config.EVENT_SECRET) {
          sendJson(res, 401, { error: 'UNAUTHENTICATED' });
          return;
        }
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'BAD_REQUEST' });
        return;
      }
      try {
        const { status, outcome } = await processDelivery(body, { port, apiRoot, log });
        sendJson(res, status, { outcome });
      } catch (error) {
        // A genuine transient failure: do NOT ack, so the platform redelivers.
        log.error('delivery processing failed; not acking', {
          error: error instanceof Error ? error.message : String(error),
        });
        sendJson(res, 500, { error: 'INTERNAL' });
      }
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });
};
