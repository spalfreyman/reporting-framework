import { readConfiguration } from '../src/env.js';
import { buildDescriptor } from '../src/descriptor.js';
import { getCustomObjectPort } from '../src/ct/client.js';
import { registerDescriptor } from '../src/shared/dsp/registration.js';

/**
 * postDeploy: publish this source's capability descriptor.
 *
 * That single write is the whole discovery mechanism. The gateway lists the
 * `reporting.datasources` container, so installing this connector extends the framework with
 * NO framework redeploy — and the reports that need it light up on their own.
 *
 * Idempotent: Connect re-runs postDeploy on every redeploy, so an unchanged descriptor is a
 * no-op rather than a needless write.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();

  if (!config.CONNECT_SERVICE_URL) {
    throw new Error(
      'CONNECT_SERVICE_URL is not set. Connect injects it at deploy time; without it the ' +
        'published descriptor would point nowhere and the gateway could not reach this source.'
    );
  }

  // Probe Product Search so the published descriptor advertises catalogue metrics only if
  // the project can actually serve them.
  let productSearchAvailable = true;
  if (config.MODE === 'live') {
    const { probeProductSearch } = await import('../src/ct/live-facets.js');
    const { getApiRoot } = await import('../src/ct/client.js');
    productSearchAvailable = await probeProductSearch(getApiRoot());
  }

  const descriptor = buildDescriptor({ productSearchAvailable });
  const outcome = await registerDescriptor(getCustomObjectPort(), descriptor);

  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      message: `descriptor ${outcome.action}`,
      sourceId: outcome.sourceId,
      endpointUrl: descriptor.endpointUrl,
      mode: config.MODE,
      metrics: descriptor.capabilities.metrics.length,
      timezone: descriptor.capabilities.timezone,
    })}\n`
  );

  // Deploy-time dependency validation: surface bad credentials now rather than letting
  // every report fail later.
  if (config.MODE === 'live') {
    const { getApiRoot } = await import('../src/ct/client.js');
    await getApiRoot().get().execute();
    process.stdout.write(
      `${JSON.stringify({ level: 'info', message: 'commercetools connectivity verified' })}\n`
    );
  }
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
