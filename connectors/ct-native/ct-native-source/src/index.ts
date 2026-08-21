import { readConfiguration } from './env.js';
import { createApp } from './app.js';
import { buildDescriptor } from './descriptor.js';
import { getApiRoot } from './ct/client.js';
import { probeProductSearch } from './ct/live-facets.js';

const main = async (): Promise<void> => {
  const config = readConfiguration();

  // In live mode, find out whether Product Search is available BEFORE advertising catalogue
  // metrics. On this demo project it is not, so the descriptor will omit them and catalogue
  // reports show as "needs a data source" rather than erroring tile by tile.
  let productSearchAvailable = true;
  if (config.MODE === 'live') {
    productSearchAvailable = await probeProductSearch(getApiRoot());
    if (!productSearchAvailable) {
      process.stdout.write(
        `${JSON.stringify({
          level: 'warn',
          message:
            'Product Search is not available on this project; live catalogue metrics will not ' +
            'be advertised. Order metrics from the rollup are unaffected.',
        })}\n`
      );
    }
  }

  const descriptor = buildDescriptor({ productSearchAvailable });
  createApp({ descriptor }).listen(config.PORT, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        message: 'ct-native data source listening',
        sourceId: config.SOURCE_ID,
        mode: config.MODE,
        port: config.PORT,
        timezone: config.ROLLUP_TIMEZONE,
        timestamp: new Date().toISOString(),
      })}\n`
    );
  });
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      message: 'ct-native data source failed to start',
      error: error instanceof Error ? error.message : String(error),
    })}\n`
  );
  process.exit(1);
});
