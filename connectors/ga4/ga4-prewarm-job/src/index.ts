import { readConfiguration } from './env.js';
import { buildApiRoot, createCustomObjectPort } from './shared-node/ct-adapter.js';
import { planPrewarm, resolveSourceUrl, toSourceQuery } from './prewarm.js';

/**
 * Nightly GA4 cache pre-warm.
 *
 * Calls the ga4-source /query for the windows dashboards open, which populates that source's
 * own cache. Deliberately sequential with a small gap: the whole point is to be gentle on the
 * property's shared token budget, so hammering it in parallel would defeat the purpose.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  const log = (level: string, message: string, extra: Record<string, unknown> = {}) =>
    process.stdout.write(`${JSON.stringify({ level, message, ...extra, timestamp: new Date().toISOString() })}\n`);

  const root = buildApiRoot({
    projectKey: config.CTP_PROJECT_KEY,
    clientId: config.CTP_CLIENT_ID,
    clientSecret: config.CTP_CLIENT_SECRET,
    scopes: config.CTP_SCOPE.split(' ').filter(Boolean),
    authUrl: config.authUrl,
    apiUrl: config.apiUrl,
  });
  const port = createCustomObjectPort(root);

  const sourceUrl = await resolveSourceUrl(port, config.SOURCE_ID, config.GA4_SOURCE_URL);
  if (!sourceUrl) {
    log('warn', 'ga4-source is not registered and no GA4_SOURCE_URL is set; nothing to pre-warm');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const targets = planPrewarm(today, config.PREWARM_LOOKBACK_DAYS);
  let warmed = 0;
  let failed = 0;

  for (const [i, target] of targets.entries()) {
    const query = toSourceQuery(config.CTP_PROJECT_KEY, config.SOURCE_ID, target, `prewarm-${today}-${i}`);
    try {
      const response = await fetch(`${sourceUrl}/${config.SOURCE_ID}-source/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.REPORTING_SHARED_SECRET}` },
        body: JSON.stringify(query),
      });
      if (response.ok) warmed += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    // A brief gap keeps the pre-warm gentle on the shared property quota.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  log('info', 'ga4 pre-warm complete', { targets: targets.length, warmed, failed });
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'error', message: 'ga4 pre-warm failed', error: error instanceof Error ? error.message : String(error) })}\n`
    );
    process.exit(1);
  });
