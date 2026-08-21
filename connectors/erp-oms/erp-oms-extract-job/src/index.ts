import { readConfiguration } from './env.js';
import { buildApiRoot, createCustomObjectPort } from './shared-node/ct-adapter.js';
import { fakeFulfilment, fakeInventory, fakeReturns } from './shared/demo/fake-erp.js';
import { EXTRACT_CONTAINER, isSliceDone, planSlices } from './extract.js';

/**
 * Nightly ERP extract. In demo mode it materialises the fake ERP's data into fact objects;
 * in live mode it would page the real ERP the same way. Chunk-bounded and resumable, with a
 * ~25-minute budget under the job's 30-minute timeout.
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

  const today = new Date().toISOString().slice(0, 10);
  const epoch = today; // one extract generation per calendar day
  const slices = planSlices(today, config.EXTRACT_LOOKBACK_DAYS);
  const deadline = Date.now() + 25 * 60_000;

  let written = 0;
  let skipped = 0;
  for (const slice of slices) {
    if (Date.now() > deadline) {
      log('warn', 'extract budget reached; resuming next run', { written, remaining: slices.length - written - skipped });
      break;
    }
    if (await isSliceDone(port, slice, epoch)) {
      skipped += 1;
      continue;
    }
    const value = {
      epoch,
      date: slice.date,
      inventory: config.MODE === 'demo' ? fakeInventory(slice.date, slice.date) : [],
      fulfilment: config.MODE === 'demo' ? fakeFulfilment(slice.date, slice.date) : [],
      returns: config.MODE === 'demo' ? fakeReturns(slice.date, slice.date) : [],
    };
    const existing = await port.get(slice.container, slice.key);
    await port.put(slice.container, slice.key, value, existing?.version);
    written += 1;
  }

  log('info', 'erp extract complete', { container: EXTRACT_CONTAINER, written, skipped });
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({ level: 'error', message: 'erp extract failed', error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exit(1);
  });
