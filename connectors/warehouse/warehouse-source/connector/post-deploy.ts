import { readConfiguration } from '../src/env.js';
import { buildDescriptor } from '../src/descriptor.js';
import { getCustomObjectPort } from '../src/client.js';
import { registerDescriptor } from '../src/shared/dsp/registration.js';

/** postDeploy: publish the warehouse descriptor so the gateway discovers it. Idempotent. */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  if (!config.CONNECT_SERVICE_URL) {
    throw new Error('CONNECT_SERVICE_URL is not set; the published descriptor would point nowhere.');
  }
  const descriptor = buildDescriptor();
  const outcome = await registerDescriptor(getCustomObjectPort(), descriptor);
  process.stdout.write(
    `${JSON.stringify({ level: 'info', message: `descriptor ${outcome.action}`, sourceId: outcome.sourceId, mode: config.MODE, kind: config.WAREHOUSE_KIND })}\n`
  );
};
main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', message: 'post-deploy failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
});
