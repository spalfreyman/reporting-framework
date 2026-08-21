import { readConfiguration } from '../src/env.js';
import { getApiRoot } from '../src/client.js';

/**
 * preUndeploy: delete the order Subscription so the platform stops delivering to an endpoint
 * that is going away. Order-facts and rollup partitions are deliberately retained — they are
 * the customer's data and are expensive to rebuild.
 */
const main = async (): Promise<void> => {
  const config = readConfiguration();
  const root = getApiRoot();
  const key = config.SUBSCRIPTION_KEY;

  const existing = await root.subscriptions().withKey({ key }).get().execute().catch(() => null);
  if (!existing) return;

  await root
    .subscriptions()
    .withKey({ key })
    .delete({ queryArgs: { version: existing.body.version } })
    .execute();
  process.stdout.write(`${JSON.stringify({ level: 'info', message: 'subscription deleted', key })}\n`);
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message: 'pre-undeploy failed', error: error instanceof Error ? error.message : String(error) })}\n`
  );
  process.exit(1);
});
