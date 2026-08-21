import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readConfiguration } from '../env.js';
import { createLogger, type Logger } from '../logger.js';
import { createCustomObjectPort } from '../ct/client.js';
import { loadPolicies, loadScopeAssignment } from '../registry/policies.js';
import {
  DEFAULT_POLICIES,
  resolveAccess,
  type EffectiveAccess,
  type Subject,
} from '../shared/framing/access.js';

/**
 * Request context: correlation id, logger, verified subject and resolved access frame.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by @commercetools-backend/express's createSessionMiddleware. */
    session?: {
      userId?: string;
      projectKey?: string;
      userPermissions?: string[];
      permissions?: string[];
      locale?: string;
    };
    correlationId?: string;
    log?: Logger;
    subject?: Subject;
    access?: EffectiveAccess;
  }
}

export const correlationMiddleware = (): RequestHandler => {
  const config = readConfiguration();
  const root = createLogger(config.LOG_LEVEL);
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-correlation-id') ?? req.header('x-reporting-request-id');
    const correlationId = incoming ?? randomUUID();
    req.correlationId = correlationId;
    req.log = root.child({ correlationId, path: req.path, method: req.method });
    res.setHeader('x-correlation-id', correlationId);
    next();
  };
};

/**
 * Builds the subject from the VERIFIED session only, then resolves the access frame
 * server-side.
 *
 * Nothing here reads a request header or body: anything the browser could set is untrusted
 * input. In particular the row scope is re-derived on every request and a client-supplied
 * `scope` is ignored entirely.
 */
export const accessMiddleware = (): RequestHandler => {
  const port = createCustomObjectPort();

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const session = req.session ?? {};
      const permissions = session.userPermissions ?? session.permissions ?? [];

      const subject: Subject = {
        id: session.userId ?? null,
        permissions,
        projectKey: session.projectKey ?? readConfiguration().CTP_PROJECT_KEY,
        locale: session.locale ?? 'en',
      };

      const stored = await loadPolicies(port);
      const policies = stored.length > 0 ? stored : DEFAULT_POLICIES;
      // Row-level scope keys off a stable subject id. When the exchange token carries none,
      // there is nothing to look an assignment up by, so the subject stays unrestricted and
      // only report- and field-level framing applies. See docs/security-model.md.
      const assignment = subject.id ? await loadScopeAssignment(port, subject.id) : null;

      req.subject = subject;
      req.access = resolveAccess(subject, policies, assignment);
      req.log = req.log?.child({ subjectId: subject.id, projectKey: subject.projectKey });
      next();
    } catch (error) {
      next(error);
    }
  };
};

/** 403s unless the verified session carries the configured reporting permission. */
export const requirePermission = (permission: string): RequestHandler => {
  const claim = permission.startsWith('can') ? permission : `can${permission}`;
  return (req: Request, res: Response, next: NextFunction) => {
    const held = req.subject?.permissions ?? [];
    if (held.includes(claim) || held.includes(permission)) {
      next();
      return;
    }
    req.log?.warn('permission denied', { required: claim, held });
    res.status(403).json({
      error: 'FORBIDDEN',
      message: `This action requires the ${claim} permission in the Merchant Center.`,
      correlationId: req.correlationId,
    });
  };
};
