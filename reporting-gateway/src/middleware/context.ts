import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { readConfiguration } from '../env.js';
import { createLogger } from '../logger.js';
import { createCustomObjectPort } from '../ct/client.js';
import { loadPolicies, loadScopeAssignment } from '../registry/policies.js';
import { DEFAULT_POLICIES, resolveAccess, type Subject } from '../shared/framing/access.js';
import type { Env } from '../http-context.js';

/**
 * Request context: correlation id, logger, verified subject and resolved access frame.
 */

export const correlationMiddleware = (): MiddlewareHandler<Env> => {
  const config = readConfiguration();
  const root = createLogger(config.LOG_LEVEL);
  return async (c, next) => {
    const incoming = c.req.header('x-correlation-id') ?? c.req.header('x-reporting-request-id');
    const correlationId = incoming ?? randomUUID();
    c.set('correlationId', correlationId);
    c.set('log', root.child({ correlationId, path: c.req.path, method: c.req.method }));
    c.header('x-correlation-id', correlationId);
    await next();
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
export const accessMiddleware = (): MiddlewareHandler<Env> => {
  const port = createCustomObjectPort();

  return async (c, next) => {
    const session = c.get('session') ?? {};
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
    // there is nothing to look an assignment up by, so the subject stays unrestricted and only
    // report- and field-level framing applies. See docs/security-model.md.
    const assignment = subject.id ? await loadScopeAssignment(port, subject.id) : null;

    c.set('subject', subject);
    c.set('access', resolveAccess(subject, policies, assignment));
    c.set('log', c.get('log').child({ subjectId: subject.id, projectKey: subject.projectKey }));
    await next();
  };
};

/** 403s unless the verified session carries the configured reporting permission. */
export const requirePermission = (permission: string): MiddlewareHandler<Env> => {
  const claim = permission.startsWith('can') ? permission : `can${permission}`;
  return async (c, next) => {
    const held = c.get('subject')?.permissions ?? [];
    if (held.includes(claim) || held.includes(permission)) {
      await next();
      return;
    }
    c.get('log')?.warn('permission denied', { required: claim, held });
    return c.json(
      {
        error: 'FORBIDDEN',
        message: `This action requires the ${claim} permission in the Merchant Center.`,
        correlationId: c.get('correlationId'),
      },
      403
    );
  };
};
