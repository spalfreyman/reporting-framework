import { readConfiguration } from './env.js';
import { createApp } from './app.js';

// Re-exported so tests (and the backfill entrypoint) can import runJob directly without
// booting the HTTP server.
export { runJob, JOB_NAME } from './job.js';

const main = (): void => {
  const config = readConfiguration();
  createApp().listen(config.PORT, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        message: 'reporting rollup job listening',
        port: config.PORT,
        timestamp: new Date().toISOString(),
      })}\n`
    );
  });
};

// Only boot the server when this file is the process entrypoint, so importing runJob in a
// test does not open a port.
const invokedDirectly =
  process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        level: 'error',
        message: 'rollup job failed to start',
        error: error instanceof Error ? error.message : String(error),
      })}\n`
    );
    process.exit(1);
  }
}
