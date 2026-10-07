import { createServer, type Server, type ServerResponse } from 'node:http';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { runJob, JOB_NAME } from './job.js';

/**
 * The job application. Mounted at /rollup-job to match connect.yaml.
 *
 * A Connect `job` is NOT a run-to-exit script: it is a long-running HTTP server that the
 * platform's scheduler triggers by POSTing to its endpoint on the cron schedule, and which
 * must reply 200. `/status` is an unauthenticated liveness probe used by the deploy health
 * check; a POST to the base path runs one rollup pass.
 *
 * runJob is lock-guarded and resumable, so an overlapping trigger is a safe no-op (it returns
 * `skipped`). We reply 200 in every non-crash case so a single slow run does not wedge the
 * scheduler into an endless redelivery loop; genuine startup/config failures still surface as
 * a 500.
 *
 * Implemented on Node's built-in `http` server rather than a framework: the app has exactly
 * two routes and no request body to parse, so a dependency here would be pure cost — and it
 * keeps the deployed tree free of the transitive packages Connect's SCA flags.
 */

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  // `x-powered-by` is deliberately never set — nothing should advertise the implementation.
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const createApp = (): Server => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { app: JOB_NAME });
  const base = '/rollup-job';

  return createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];

    if (req.method === 'GET' && path === `${base}/status`) {
      sendJson(res, 200, { status: 'ok', app: JOB_NAME });
      return;
    }

    if (req.method === 'POST' && path === base) {
      try {
        const result = await runJob();
        sendJson(res, 200, { ...result, app: JOB_NAME });
      } catch (error) {
        log.error('rollup job failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        sendJson(res, 500, { error: 'INTERNAL' });
      }
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });
};
