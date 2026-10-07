import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
 * `/health` is unauthenticated so a liveness probe works; `/describe` and `/query` require the
 * shared secret, compared in constant time.
 *
 * Implemented on Node's built-in `http` server rather than Express: the `createDspHandlers`
 * harness already carries auth, validation and error shaping (returning `{ status, body }`), so
 * the HTTP layer is a thin dispatcher — and dropping Express keeps `proxy-addr` out of the
 * deployed tree, which Connect's software-composition analysis flags.
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

export const createApp = (options: { descriptor?: ReturnType<typeof buildDescriptor> } = {}): Server => {
  const config = readConfiguration();

  // Built once. In demo mode the SDK client is never constructed, so the connector runs with no
  // reachable commercetools project at all. In live mode index.ts probes Product Search first
  // and passes a descriptor that reflects what this project can actually serve.
  const descriptor = options.descriptor ?? buildDescriptor();

  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler({ apiRoot: getApiRoot, port: getCustomObjectPort }),
    health: async () => ({ mode: config.MODE, timezone: config.ROLLUP_TIMEZONE }),
  });

  const base = '/ct-native-source';

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
