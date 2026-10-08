// restate-categories.mjs — one-off Option C restatement for a project whose order-facts
// predate category resolution.
//
// WHY THIS EXISTS
// ---------------
// The rollup job's `writeOrderFact` has a monotonic version guard: it skips rewriting a fact
// when the stored order version is >= the one just scanned. So simply re-running the job does
// NOT recategorise history — unchanged orders are skipped, and their facts keep category=NONE.
// To backfill real categories onto existing orders you must (a) reset the scan cursor so the
// job re-scans everything, and (b) delete the stale per-order facts so they are rebuilt WITH
// categories (bypassing the guard). This script does exactly that.
//
// WHAT IT TOUCHES (all commercetools Custom Objects, nothing else)
//   - reporting.cursors / reporting-rollup-job          -> deleted (forces a full re-scan)
//   - reporting.order-facts-<yyyy-mm> / <orderId>        -> deleted (rebuilt by the job with categories)
//   - reporting.facts.<cube> / <partition>               -> deleted ONLY with --clear-cubes
//
// It never touches orders, products, or any other project data. Order-facts and cube
// partitions are derived data that the rollup job rebuilds from the orders themselves.
//
// AFTER RUNNING
//   The reporting-rollup-job re-scans on its next */10 cron tick, rewrites every order's fact
//   with its resolved category, and folds all cubes — including order-categories-daily. A full
//   history rebuild may span several cron ticks (it is budget-bounded and resumable).
//   Note: the scan only reaches back as far as the connector's BACKFILL_DAYS (default 400);
//   orders older than that window are not re-scanned, so do not delete their facts if you need
//   them — this script deletes ALL order-facts, so anything beyond the window would be dropped
//   until/unless re-scanned. For the sp-demo dataset (recent, generated) this is fine.
//
// USAGE (from this folder, which has the SDK deps installed)
//   cd reporting-rollup-job
//   CTP_PROJECT_KEY=sp-demo \
//   CTP_REGION=europe-west1.gcp \
//   CTP_CLIENT_ID=xxx CTP_CLIENT_SECRET=xxx \
//   CTP_SCOPE="manage_key_value_documents:sp-demo view_key_value_documents:sp-demo" \
//   node restate-categories.mjs            # DRY RUN — reports what it would delete
//
//   ...same env... node restate-categories.mjs --apply               # actually delete
//   ...same env... node restate-categories.mjs --apply --clear-cubes # also clear cube partitions
//
// The client needs manage_key_value_documents (plus view_key_value_documents) on the project.

import { ClientBuilder } from '@commercetools/ts-client';
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';

const APPLY = process.argv.includes('--apply');
const CLEAR_CUBES = process.argv.includes('--clear-cubes');

const CURSOR = { container: 'reporting.cursors', key: 'reporting-rollup-job' };
// Half-open container ranges: '-' (0x2D) < '.' (0x2E), so every "reporting.order-facts-*"
// container sorts below "reporting.order-facts." and above "reporting.order-facts-".
const ORDER_FACTS_RANGE = { from: 'reporting.order-facts-', to: 'reporting.order-facts.' };
const CUBES_RANGE = { from: 'reporting.facts.', to: 'reporting.facts/' }; // '.'(0x2E) < '/'(0x2F)

const env = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
};

const projectKey = env('CTP_PROJECT_KEY');
const region = env('CTP_REGION');
const clientId = env('CTP_CLIENT_ID');
const clientSecret = env('CTP_CLIENT_SECRET');
const scopes = env('CTP_SCOPE').split(/\s+/).filter(Boolean);

const apiRoot = createApiBuilderFromCtpClient(
  new ClientBuilder()
    .withClientCredentialsFlow({
      host: `https://auth.${region}.commercetools.com`,
      projectKey,
      credentials: { clientId, clientSecret },
      scopes,
    })
    .withHttpMiddleware({ host: `https://api.${region}.commercetools.com` })
    .build()
).withProjectKey({ projectKey });

const deleteCustomObject = async (container, key, version) => {
  if (!APPLY) return true; // dry run
  try {
    await apiRoot
      .customObjects()
      .withContainerAndKey({ container, key })
      .delete({ queryArgs: { version } })
      .execute();
    return true;
  } catch (error) {
    // A concurrent writer (the running job) may have bumped the version or removed it; skip.
    const status = error?.statusCode ?? error?.body?.statusCode;
    if (status === 404 || status === 409) return false;
    throw error;
  }
};

/** Keyset-paginate every custom object whose container is in [from, to), deleting each. */
const purgeContainerRange = async (label, { from, to }) => {
  let deleted = 0;
  let scanned = 0;
  let afterId = '';
  for (;;) {
    const where = [
      `container >= "${from}"`,
      `container < "${to}"`,
      ...(afterId ? [`id > "${afterId}"`] : []),
    ].join(' and ');
    const page = await apiRoot
      .customObjects()
      .get({ queryArgs: { where, sort: 'id asc', limit: 200, withTotal: false } })
      .execute();
    const results = page.body.results;
    if (results.length === 0) break;
    for (const obj of results) {
      scanned += 1;
      if (await deleteCustomObject(obj.container, obj.key, obj.version)) deleted += 1;
    }
    afterId = results[results.length - 1].id;
    process.stdout.write(`  ${label}: ${APPLY ? 'deleted' : 'would delete'} ${deleted} (scanned ${scanned})\r`);
    if (results.length < 200) break;
  }
  process.stdout.write('\n');
  return { deleted, scanned };
};

const run = async () => {
  console.log(
    `Option C restatement on project "${projectKey}" (${region}) — ${APPLY ? 'APPLY' : 'DRY RUN'}${CLEAR_CUBES ? ' + clear-cubes' : ''}\n`
  );

  // 1. Reset the rollup cursor so the next run re-scans from the beginning.
  const cursor = await apiRoot
    .customObjects()
    .withContainerAndKey(CURSOR)
    .get()
    .execute()
    .then((r) => r.body)
    .catch(() => null);
  if (cursor) {
    const ok = await deleteCustomObject(cursor.container, cursor.key, cursor.version);
    console.log(`cursor ${CURSOR.container}/${CURSOR.key}: ${APPLY ? (ok ? 'deleted' : 'skipped') : 'would delete'}`);
  } else {
    console.log(`cursor ${CURSOR.container}/${CURSOR.key}: not present (already reset)`);
  }

  // 2. Delete stale per-order facts so they are rebuilt with categories.
  console.log('order-facts:');
  const facts = await purgeContainerRange('order-facts', ORDER_FACTS_RANGE);

  // 3. Optionally clear materialized cube partitions so cubes rebuild cleanly.
  let cubes = { deleted: 0, scanned: 0 };
  if (CLEAR_CUBES) {
    console.log('cube partitions:');
    cubes = await purgeContainerRange('cubes', CUBES_RANGE);
  }

  console.log('\nSummary');
  console.log(`  order-facts ${APPLY ? 'deleted' : 'to delete'}: ${facts.deleted}`);
  if (CLEAR_CUBES) console.log(`  cube partitions ${APPLY ? 'deleted' : 'to delete'}: ${cubes.deleted}`);
  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with --apply to perform the restatement.');
  } else {
    console.log(
      '\nDone. The reporting-rollup-job will re-scan and rebuild facts (with categories) on its'
    );
    console.log('next */10 cron tick; order-categories-daily will populate as days are re-folded.');
  }
};

run().catch((error) => {
  console.error('\nRestatement failed:', error?.message ?? error);
  process.exit(1);
});
