import { readConfiguration } from './env.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';

/**
 * Entry point. Configuration is validated BEFORE the server binds, so a bad deploy fails
 * visibly at boot rather than on the first request.
 */
const main = (): void => {
  const config = readConfiguration();
  const log = createLogger(config.LOG_LEVEL, { service: 'reporting-gateway' });

  createApp().listen(config.PORT, () => {
    log.info('reporting gateway listening', {
      port: config.PORT,
      projectKey: config.CTP_PROJECT_KEY,
      region: config.CTP_REGION,
      sessionAudience: config.sessionAudience,
    });
  });
};

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      message: 'reporting gateway failed to start',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`
  );
  process.exit(1);
}
