import { readConfiguration } from './env.js';
import { buildApiRoot, createCustomObjectPort } from './shared-node/ct-adapter.js';
import { planPrewarm, resolveSourceUrl, toSourceQuery } from './prewarm.js';

/**
 * One pre-warm / extract pass.
 *
 * Connect triggers this by POSTing to the app's endpoint on the cron schedule; the HTTP
 * wrapper in app.ts calls runPrewarm and always replies 200. runPrewarm never touches the
 * process lifecycle, so it stays trivially unit-testable.
 */

export const JOB_NAME = '__SOURCE_ID__-prewarm-job';

const logLine = (level: string, message: string, extra: Record<string, unknown> = {}) =>
  process.stdout.write(
    `${JSON.stringify({ level, message, ...extra, app: JOB_NAME, timestamp: new Date().toISOString() })}\n`
  );

export const runPrewarm = async (): Promise<{
  skipped: boolean;
  targets: number;
  warmed: number;
  failed: number;
}> => {
  const config = readConfiguration();

  const root = buildApiRoot({
    projectKey: config.CTP_PROJECT_KEY,
    clientId: config.CTP_CLIENT_ID,
    clientSecret: config.CTP_CLIENT_SECRET,
    scopes: config.CTP_SCOPE.split(' ').filter(Boolean),
    authUrl: config.authUrl,
    apiUrl: config.apiUrl,
  });
  const port = createCustomObjectPort(root);

  const sourceUrl = await resolveSourceUrl(port, config.SOURCE_ID, config.SOURCE_URL);
  if (!sourceUrl) {
    logLine('warn', 'source is not registered and no SOURCE_URL is set; nothing to pre-warm');
    return { skipped: true, targets: 0, warmed: 0, failed: 0 };
  }

  // The registered descriptor's endpointUrl already includes the app's mount path
  // (e.g. `.../__SOURCE_ID__-source`), so the query endpoint is `<endpointUrl>/query`. Only
  // append the mount segment when it is NOT already present — which also keeps an origin-only
  // SOURCE_URL override working.
  const mount = `/${config.SOURCE_ID}-source`;
  const queryUrl = sourceUrl.endsWith(mount) ? `${sourceUrl}/query` : `${sourceUrl}${mount}/query`;

  const today = new Date().toISOString().slice(0, 10);
  const targets = planPrewarm(today, config.PREWARM_LOOKBACK_DAYS);
  let warmed = 0;
  let failed = 0;

  for (const [i, target] of targets.entries()) {
    const query = toSourceQuery(config.CTP_PROJECT_KEY, config.SOURCE_ID, target, `prewarm-${today}-${i}`);
    try {
      const response = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.REPORTING_SHARED_SECRET}` },
        body: JSON.stringify(query),
      });
      if (response.ok) warmed += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    // A brief gap keeps the pass gentle on any rate-limited upstream.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  logLine('info', 'pre-warm complete', { targets: targets.length, warmed, failed });
  return { skipped: false, targets: targets.length, warmed, failed };
};
