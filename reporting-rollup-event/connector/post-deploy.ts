import { readConfiguration } from '../src/env.js';
import { getApiRoot } from '../src/client.js';

/**
 * postDeploy: register the order Subscription, idempotently.
 *
 * Connect provisions the destination (queue/topic) for an `event` application and injects
 * its coordinates as environment variables; this script points a commercetools Subscription
 * at that destination for the order message types the rollup cares about.
 *
 * Idempotent by construction — get-by-key then update, create only if absent — because
 * Connect re-runs postDeploy on every redeploy. Never delete-then-recreate: that would drop
 * messages in the gap.
 */
const RELEVANT_TYPES = [
  'OrderCreated',
  'OrderImported',
  'OrderStateChanged',
  'OrderPaymentStateChanged',
  'OrderShipmentStateChanged',
  'ReturnInfoAdded',
  'ReturnInfoSet',
  'OrderCustomerSet',
  'OrderStoreSet',
];

/**
 * Reads the destination Connect injected for this event app. Connect's exact variable names
 * depend on the destination type; these cover the common Pub/Sub and SQS shapes. When none
 * are present (local runs), the Subscription is skipped rather than failing the deploy.
 */
const destinationFromEnv = (): Record<string, unknown> | null => {
  const env = process.env;
  if (env.CONNECT_GCP_TOPIC_NAME && env.CONNECT_GCP_PROJECT_ID) {
    return {
      type: 'GoogleCloudPubSub',
      topic: env.CONNECT_GCP_TOPIC_NAME,
      projectId: env.CONNECT_GCP_PROJECT_ID,
    };
  }
  if (env.CONNECT_SQS_QUEUE_URL && env.CONNECT_SQS_REGION) {
    return {
      type: 'SQS',
      queueUrl: env.CONNECT_SQS_QUEUE_URL,
      region: env.CONNECT_SQS_REGION,
      authenticationMode: 'IAM',
    };
  }
  return null;
};

const main = async (): Promise<void> => {
  const config = readConfiguration();
  const root = getApiRoot();
  const key = config.SUBSCRIPTION_KEY;

  const destination = destinationFromEnv();
  if (!destination) {
    process.stdout.write(
      `${JSON.stringify({
        level: 'warn',
        message:
          'No Connect-provided destination found in the environment; skipping Subscription ' +
          'creation. This is expected for a local run and for a platform that manages the ' +
          'destination itself.',
      })}\n`
    );
    return;
  }

  const draft = {
    key,
    destination,
    messages: [{ resourceTypeId: 'order', types: RELEVANT_TYPES }],
  };

  const existing = await root
    .subscriptions()
    .withKey({ key })
    .get()
    .execute()
    .catch(() => null);

  if (existing) {
    await root
      .subscriptions()
      .withKey({ key })
      .post({
        body: {
          version: existing.body.version,
          actions: [
            { action: 'setMessages', messages: draft.messages },
            { action: 'changeDestination', destination: destination as never },
          ],
        },
      })
      .execute();
    process.stdout.write(`${JSON.stringify({ level: 'info', message: 'subscription updated', key })}\n`);
  } else {
    await root.subscriptions().post({ body: draft as never }).execute();
    process.stdout.write(`${JSON.stringify({ level: 'info', message: 'subscription created', key })}\n`);
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
