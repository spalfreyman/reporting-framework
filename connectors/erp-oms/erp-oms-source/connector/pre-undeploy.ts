import { readConfiguration } from '../src/env.js';
import { getCustomObjectPort } from '../src/client.js';
import { unregisterDescriptor } from '../src/shared/dsp/registration.js';

/** preUndeploy: withdraw only this source's descriptor. The result cache is left to expire. */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  await unregisterDescriptor(getCustomObjectPort(), config.SOURCE_ID);
  process.stdout.write(
    `${JSON.stringify({ level: 'info', message: 'descriptor withdrawn', sourceId: config.SOURCE_ID })}\n`
  );
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message: 'pre-undeploy failed', error: error instanceof Error ? error.message : String(error) })}\n`
  );
  process.exit(1);
});
