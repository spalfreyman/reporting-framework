import { createCustomObjectPort } from '../src/ct/client.js';
import { readConfiguration } from '../src/env.js';
import { CO } from '../src/shared/schema/descriptor.js';
import { createLogger } from '../src/logger.js';

/**
 * preUndeploy: withdraw the published gateway URL.
 *
 * Deliberately does NOT delete report definitions, rollup facts, access policies or scope
 * assignments. Those are the customer's data and outlive the connector; deleting them on
 * undeploy would turn a routine redeploy mishap into data loss.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { script: 'pre-undeploy' });
  const port = createCustomObjectPort();

  await port.delete(CO.config, CO.keys.gateway);
  log.info('withdrew the published gateway URL', {
    note: 'report definitions, facts and access policies are intentionally retained',
  });
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
