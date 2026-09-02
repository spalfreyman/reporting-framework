import { createCustomObjectPort } from '../src/ct/client.js';
import { readConfiguration } from '../src/env.js';
import { CO } from '../src/shared/schema/descriptor.js';
import { createLogger } from '../src/logger.js';

/**
 * postDeploy: publish the gateway's own URL, and seed the restatement epoch.
 *
 * The Merchant Center app is a static bundle and cannot be told the gateway URL at build
 * time. Rather than making the operator paste it and redeploy, the gateway writes its own
 * Connect-injected URL here and the app discovers it at boot. That makes the whole
 * connector a single-pass deploy.
 *
 * Idempotent by construction: get-then-update, create only if absent. Connect re-runs
 * postDeploy on every redeploy.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { script: 'post-deploy' });
  const port = createCustomObjectPort();

  const existing = await port.get<{ url?: string }>(CO.config, CO.keys.gateway);
  const desired = {
    // Publish the ORIGIN, not CONNECT_SERVICE_URL. Connect's injected service URL already
    // includes this app's `/gateway` endpoint suffix (e.g. https://service-xxx.../gateway),
    // but the Merchant Center app builds every request as `${gatewayUrl}/gateway/reports...`
    // — it adds `/gateway` itself, because the gateway's Express router is mounted at
    // `/gateway`. Publishing the full service URL would double the segment
    // (.../gateway/gateway/reports → 404). The origin is exactly `sessionAudience`.
    url: config.sessionAudience,
    audience: config.sessionAudience,
    deployedAt: new Date().toISOString(),
  };

  if (existing?.value.url === desired.url) {
    log.info('gateway URL already published; nothing to do', { url: desired.url });
  } else {
    await port.put(CO.config, CO.keys.gateway, desired, existing?.version);
    log.info('published the gateway URL for the Merchant Center app to discover', {
      url: desired.url,
    });
  }

  // The restatement epoch is part of every cache key, so a backfill can invalidate every
  // cached tile with one write. Seed it only if absent — never reset it.
  const epoch = await port.get<{ restatementEpoch: number }>(CO.config, CO.keys.epoch);
  if (!epoch) {
    await port.put(CO.config, CO.keys.epoch, { restatementEpoch: 1 });
    log.info('seeded the restatement epoch');
  }

  // Fail the deploy loudly if the API client cannot actually reach commercetools, rather
  // than letting every report 500 later.
  const probe = await port.query(CO.datasources, { limit: 1 });
  log.info('deploy-time connectivity verified', { registeredSources: probe.results.length });
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      message: 'post-deploy failed',
      error: error instanceof Error ? error.message : String(error),
    })}\n`
  );
  process.exit(1);
});
