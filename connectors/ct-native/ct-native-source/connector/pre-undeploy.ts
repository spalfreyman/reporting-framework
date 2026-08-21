import { readConfiguration } from '../src/env.js';
import { getCustomObjectPort } from '../src/ct/client.js';
import { unregisterDescriptor } from '../src/shared/dsp/registration.js';

/**
 * preUndeploy: withdraw only OUR descriptor.
 *
 * Rollup facts are deliberately left alone. They are the customer's data, they took hours to
 * build, and they outlive this connector — deleting them here would turn a routine redeploy
 * mishap into a long backfill.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  await unregisterDescriptor(getCustomObjectPort(), config.SOURCE_ID);
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      message: 'descriptor withdrawn; reports needing this source will show as unavailable',
      sourceId: config.SOURCE_ID,
      note: 'rollup facts are intentionally retained',
    })}\n`
  );
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      message: 'pre-undeploy failed',
      error: error instanceof Error ? error.message : String(error),
    })}\n`
  );
  process.exit(1);
});
