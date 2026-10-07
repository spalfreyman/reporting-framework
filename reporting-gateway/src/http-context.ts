import type { Logger } from './logger.js';
import type { EffectiveAccess, Subject } from './shared/framing/access.js';

/**
 * The per-request context the gateway carries on Hono's `c.var`, replacing the Express
 * `Request` augmentation. Everything here is derived server-side from the verified session;
 * nothing is read from a client-supplied header or body.
 */
export type SessionClaims = {
  userId?: string;
  projectKey?: string;
  userPermissions?: string[];
  permissions?: string[];
  locale?: string;
};

export type Variables = {
  correlationId: string;
  log: Logger;
  /** Populated by the session middleware from the verified Merchant Center exchange JWT. */
  session?: SessionClaims;
  subject?: Subject;
  access?: EffectiveAccess;
};

export type Env = { Variables: Variables };
