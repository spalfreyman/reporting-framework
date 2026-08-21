import { readConfiguration } from './env.js';
import { createApp } from './app.js';

const main = (): void => {
  const config = readConfiguration();
  createApp().listen(config.PORT, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        message: 'ga4 data source listening',
        sourceId: config.SOURCE_ID,
        mode: config.MODE,
        port: config.PORT,
        timezone: config.GA4_TIMEZONE,
        timestamp: new Date().toISOString(),
      })}\n`
    );
  });
};

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      message: 'ga4 data source failed to start',
      error: error instanceof Error ? error.message : String(error),
    })}\n`
  );
  process.exit(1);
}
