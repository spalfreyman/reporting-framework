import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readConfiguration } from './env.js';
import { buildDescriptor } from './descriptor.js';
import { createQueryHandler } from './handler.js';
import { getCustomObjectPort } from './client.js';
import { createDspHandlers } from './shared/dsp/server.js';
import { TokenBucket } from './quota.js';

/**
 * The GA4 data source: the three DSP endpoints, mounted at the connect.yaml base path. In demo
 * mode no GA4 client or commercetools cache is touched at all.
 *
 * Implemented on Node's built-in `http` server rather than Express: the `createDspHandlers`
 * harness already carries auth, validation and error shaping (returning `{ status, body }`), so
 * dropping Express just removes `proxy-addr` from the deployed tree, which Connect's
 * software-composition analysis flags.
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
  const bucket = new TokenBucket(config.GA4_TOKENS_PER_HOUR, config.GA4_TOKENS_PER_HOUR);

  const handlers = createDspHandlers({
    sharedSecret: config.REPORTING_SHARED_SECRET,
    descriptor: () => descriptor,
    handler: createQueryHandler({ port: getCustomObjectPort(), bucket }),
    health: async () => ({ mode: config.MODE, tokensAvailable: bucket.available }),
  });

  const base = '/ga4-source';

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
