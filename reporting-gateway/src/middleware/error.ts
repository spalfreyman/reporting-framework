import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../http-context.js';

/**
 * An error carrying an HTTP status. The session middleware throws this as a 401 so an
 * unauthenticated request never surfaces as a 500.
 */
export class GatewayError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string, cause?: unknown) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Terminal error handler (Hono `app.onError`).
 *
 * Returns a generic message with a correlation id. Never a stack trace, never an upstream
 * error body: those leak internal hostnames, query shapes and occasionally credentials. The
 * detail goes to the logs, which is where it belongs.
 */
export const errorHandler = (error: unknown, c: Context<Env>): Response => {
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode) || 500
      : 500;

  const log = c.get('log');
  const cause = error instanceof Error ? (error.cause as unknown) : undefined;

  // A 4xx is expected traffic, not an incident: an unauthenticated probe, a client bug, a bad
  // filter. Logging it at error level with a stack drowns the real failures and trips alerts
  // on routine noise. Stacks are only useful for the 5xx case anyway.
  if (status >= 500) {
    log?.error('request failed', {
      status,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } else {
    log?.warn('request rejected', {
      status,
      error: error instanceof Error ? error.message : String(error),
      ...(cause instanceof Error ? { reason: cause.message } : {}),
    });
  }

  const correlationId = c.get('correlationId');
  if (correlationId) c.header('x-correlation-id', correlationId);

  // 401 from the session middleware is expected and safe to name.
  if (status === 401) {
    return c.json(
      {
        error: 'UNAUTHENTICATED',
        message: 'The Merchant Center session could not be verified.',
        correlationId,
      },
      401
    );
  }

  const is4xx = status >= 400 && status < 500;
  return c.json(
    {
      error: is4xx ? 'BAD_REQUEST' : 'INTERNAL',
      message: is4xx
        ? 'The request could not be processed.'
        : 'The reporting gateway encountered an internal error.',
      correlationId,
    },
    (is4xx ? status : 500) as ContentfulStatusCode
  );
};
