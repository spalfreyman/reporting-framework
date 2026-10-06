import { readConfiguration } from '../src/env.js';
import { buildDescriptor } from '../src/descriptor.js';
import { getCustomObjectPort } from '../src/client.js';
import { registerDescriptor } from '../src/shared/dsp/registration.js';

/**
 * postDeploy: publish this source's capability descriptor so the gateway discovers it.
 *
 * Idempotent (get-then-compare-then-update). Connect re-runs postDeploy on every redeploy,
 * so this must never delete-then-recreate. The descriptor's endpointUrl comes from Connect's
 * injected CONNECT_SERVICE_URL — that is what makes install a single pass with no manual URL
 * paste.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  if (!config.CONNECT_SERVICE_URL) {
    throw new Error('CONNECT_SERVICE_URL is not set; the published descriptor would point nowhere.');
  }
  const descriptor = buildDescriptor();
  const outcome = await registerDescriptor(getCustomObjectPort(), descriptor);
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      message: `descriptor ${outcome.action}`,
      sourceId: outcome.sourceId,
      metrics: descriptor.capabilities.metrics.length,
    })}\n`
  );
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
