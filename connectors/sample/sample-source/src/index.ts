import { readConfiguration } from './env.js';
import { createApp } from './app.js';

/**
 * A Connect `service` is a long-running HTTP server: it must listen on PORT and answer a
 * liveness probe. Connect injects PORT and CONNECT_SERVICE_URL.
 */
const main = (): void => {
  const config = readConfiguration();
  createApp().listen(config.PORT, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        message: 'sample data source listening',
        sourceId: config.SOURCE_ID,
        port: config.PORT,
        timestamp: new Date().toISOString(),
      })}\n`
    );
  });
};

main();
