import { readConfiguration } from './env.js';
import { createApp } from './app.js';

const main = (): void => {
  const config = readConfiguration();
  createApp().listen(config.PORT, () => {
    process.stdout.write(
      `${JSON.stringify({ level: 'info', message: 'warehouse data source listening', sourceId: config.SOURCE_ID, mode: config.MODE, kind: config.WAREHOUSE_KIND, port: config.PORT, timestamp: new Date().toISOString() })}\n`
    );
  });
};
try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ level: 'error', message: 'warehouse data source failed to start', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
}
