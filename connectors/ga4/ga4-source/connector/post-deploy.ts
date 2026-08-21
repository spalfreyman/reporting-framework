import { readConfiguration } from '../src/env.js';
import { buildDescriptor } from '../src/descriptor.js';
import { getCustomObjectPort } from '../src/client.js';
import { registerDescriptor } from '../src/shared/dsp/registration.js';

/**
 * postDeploy: publish the GA4 capability descriptor so the gateway discovers this source.
 * Idempotent (get-then-compare-then-update). In live mode it also fails fast on bad GA4
 * credentials rather than letting every report degrade later.
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
      mode: config.MODE,
      metrics: descriptor.capabilities.metrics.length,
    })}\n`
  );

  if (config.MODE === 'live') {
    const { runGa4Report } = await import('../src/live.js');
    const { addDays } = await import('../src/shared/util/date-range.js');
    const today = new Date().toISOString().slice(0, 10);
    // A real, non-empty window: timeRange is half-open, so from=7 days ago, to=tomorrow
    // covers the last week including today. (from===to would be a zero-width range.)
    const from = addDays(today, -7);
    const to = addDays(today, 1);
    await runGa4Report({
      protocolVersion: 1,
      requestId: 'post-deploy-probe',
      projectKey: config.CTP_PROJECT_KEY,
      metrics: ['sessions.count'],
      dimensions: [],
      grain: 'day',
      timeRange: { from, to },
      timezone: config.GA4_TIMEZONE,
      filters: [],
      scope: { unrestricted: true },
      orderBy: [],
      limit: 1,
      budgetMs: 20000,
    });
    process.stdout.write(`${JSON.stringify({ level: 'info', message: 'GA4 connectivity verified' })}\n`);
  }
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message: 'post-deploy failed', error: error instanceof Error ? error.message : String(error) })}\n`
  );
  process.exit(1);
});
