/**
 * Structured JSON logging with a correlation id on every line.
 *
 * A request without a correlation id is untraceable across the gateway and the data-source
 * connectors it fans out to, which is exactly when you need the logs.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  correlationId?: string;
  subjectId?: string | null;
  projectKey?: string;
  reportId?: string;
  tileId?: string;
  sourceId?: string;
  [key: string]: unknown;
}

const emit = (level: Level, minimum: Level, message: string, context: LogContext): void => {
  if (ORDER[level] < ORDER[minimum]) return;
  const line = { level, message, timestamp: new Date().toISOString(), ...context };
  const serialised = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${serialised}\n`);
  else process.stdout.write(`${serialised}\n`);
};

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  child: (context: LogContext) => Logger;
}

export const createLogger = (minimum: Level = 'info', base: LogContext = {}): Logger => ({
  debug: (message, context) => emit('debug', minimum, message, { ...base, ...context }),
  info: (message, context) => emit('info', minimum, message, { ...base, ...context }),
  warn: (message, context) => emit('warn', minimum, message, { ...base, ...context }),
  error: (message, context) => emit('error', minimum, message, { ...base, ...context }),
  child: (context) => createLogger(minimum, { ...base, ...context }),
});
