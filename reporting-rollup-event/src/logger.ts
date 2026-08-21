type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured JSON logging with a per-run id, so a scheduled run is traceable. */
export const createLogger = (minimum: Level, base: Record<string, unknown> = {}) => {
  const emit = (level: Level, message: string, context: Record<string, unknown> = {}) => {
    if (ORDER[level] < ORDER[minimum]) return;
    const line = JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...base, ...context });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
    info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
    warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
    error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
  };
};
export type Logger = ReturnType<typeof createLogger>;
