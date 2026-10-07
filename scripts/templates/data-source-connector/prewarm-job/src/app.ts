import { createServer, type Server, type ServerResponse } from 'node:http';
import { runPrewarm, JOB_NAME } from './job.js';

/**
 * The job application. Mounted at /__SOURCE_ID__-prewarm-job to match connect.yaml.
 *
 * A Connect `job` is NOT a run-to-exit script: the scheduler triggers it by POSTing to its
 * endpoint on the cron schedule, and it must pass a liveness probe and reply 200. `/status` is
 * the probe; a POST to the base path runs one pass. We reply 200 on every non-crash so a single
 * slow run does not wedge the scheduler into an endless redelivery loop.
 *
 * Built on Node's `http` server rather than Express so the deployed tree stays free of
 * `proxy-addr`, which Connect's software-composition analysis flags.
 */

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const createApp = (): Server => {
  const base = '/__SOURCE_ID__-prewarm-job';

  return createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];

    if (req.method === 'GET' && path === `${base}/status`) {
      sendJson(res, 200, { status: 'ok', app: JOB_NAME });
      return;
    }

    if (req.method === 'POST' && path === base) {
      try {
        const result = await runPrewarm();
        sendJson(res, 200, { ...result, app: JOB_NAME });
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            level: 'error',
            message: 'pre-warm failed',
            app: JOB_NAME,
            error: error instanceof Error ? error.message : String(error),
          })}\n`
        );
        sendJson(res, 500, { error: 'INTERNAL' });
      }
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });
};
