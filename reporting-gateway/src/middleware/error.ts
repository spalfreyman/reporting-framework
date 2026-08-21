import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

/**
 * Terminal error handler.
 *
 * Returns a generic message with a correlation id. Never a stack trace, never an upstream
 * error body: those leak internal hostnames, query shapes and occasionally credentials.
 * The detail goes to the logs, which is where it belongs.
 */
export const errorMiddleware = (): ErrorRequestHandler => {
  return (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode) || 500
        : 500;

    // A 4xx is expected traffic, not an incident: an unauthenticated probe, a client bug,
    // a bad filter. Logging it at error level with a stack drowns the real failures and
    // trips alerts on routine noise. Stacks are only useful for the 5xx case anyway.
    const cause = error instanceof Error ? (error.cause as unknown) : undefined;
    if (status >= 500) {
      req.log?.error('request failed', {
        status,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    } else {
      req.log?.warn('request rejected', {
        status,
        error: error instanceof Error ? error.message : String(error),
        ...(cause instanceof Error ? { reason: cause.message } : {}),
      });
    }

    // 401/403 from the session middleware are expected and safe to name.
    if (status === 401) {
      res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'The Merchant Center session could not be verified.',
        correlationId: req.correlationId,
      });
      return;
    }

    res.status(status >= 400 && status < 500 ? status : 500).json({
      error: status >= 400 && status < 500 ? 'BAD_REQUEST' : 'INTERNAL',
      message:
        status >= 400 && status < 500
          ? 'The request could not be processed.'
          : 'The reporting gateway encountered an internal error.',
      correlationId: req.correlationId,
    });
  };
};
