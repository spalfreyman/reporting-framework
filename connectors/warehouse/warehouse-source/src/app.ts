import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readConfiguration } from './env.js';
import { buildDescriptor } from './descriptor.js';
import { createQueryHandler } from './handler.js';
import { createDspHandlers } from './shared/dsp/server.js';

/**
 * The three DSP endpoints. `/health` is unauthenticated liveness; `/describe` and `/query`
 * require the shared secret. The harness in shared/dsp/server.ts carries auth, validation and
 * error shaping (returning `{ status, body }`), so this HTTP layer is a thin dispatcher on
 * Node's built-in `http` server — keeping Express (and `proxy-addr`, flagged by Connect's SCA)
 * out of the deployed tree.
 */

const MAX_BODY_BYTES = 1024 * 1024;

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

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
  const descriptor = buildDescriptor();
  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler(),
    health: async () => ({ mode: config.MODE, kind: config.WAREHOUSE_KIND }),
  });

  const base = '/warehouse-source';

  return createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    const auth = req.headers['authorization'];

    if (req.method === 'GET' && path === `${base}/health`) {
      const { status, body } = await handlers.health();
      sendJson(res, status, body);
      return;
    }
    if (req.method === 'GET' && path === `${base}/describe`) {
      const { status, body } = await handlers.describe(auth);
      sendJson(res, status, body);
      return;
    }
    if (req.method === 'POST' && path === `${base}/query`) {
      let parsed: unknown;
      try {
        parsed = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'BAD_REQUEST', message: 'Malformed JSON body.' });
        return;
      }
      const { status, body } = await handlers.query(auth, parsed);
      sendJson(res, status, body);
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });
};
