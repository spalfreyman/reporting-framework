import { createSessionMiddleware, CLOUD_IDENTIFIERS } from '@commercetools-backend/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readConfiguration } from '../env.js';

/**
 * Verifies the Merchant Center exchange JWT.
 *
 * The Merchant Center app never holds a credential. It calls the MC API Gateway's
 * `/proxy/forward-to` endpoint, which mints a short-lived signed token carrying the
 * logged-in user's identity, project and — because the app sets
 * `includeUserPermissions` — their Merchant Center permissions. This middleware is the
 * only thing that makes those claims trustworthy, so everything downstream depends on it.
 *
 * Two easy ways to get this wrong, both of which fail closed:
 *  - `audience` must be ORIGIN ONLY, matching the `forward-url-origin` policy the app sends.
 *    A full path here will not match and every request 401s.
 *  - `issuer` must be the cloud the project actually lives in.
 *
 * The verifier requires two headers that only `/proxy/forward-to` sets
 * (`X-MC-API-Cloud-Identifier` and `X-MC-API-Forward-To-Version`), pins the algorithm to
 * RS256 — so an `alg: none` token is rejected outright — and on success populates
 * `request.session` with `userId` (the JWT `sub`), `projectKey` and, when the app asked for
 * them, `userPermissions`. That `userId` is the stable identity row-level scoping keys off.
 */

const ISSUERS: Record<string, string> = {
  'gcp-eu': CLOUD_IDENTIFIERS.GCP_EU,
  'gcp-us': CLOUD_IDENTIFIERS.GCP_US,
  'aws-eu': CLOUD_IDENTIFIERS.AWS_EU,
  'aws-us': CLOUD_IDENTIFIERS.AWS_US,
  'gcp-au': CLOUD_IDENTIFIERS.GCP_AU,
};

export const sessionMiddleware = (): RequestHandler => {
  const config = readConfiguration();
  const issuer = ISSUERS[config.CLOUD_IDENTIFIER];
  if (!issuer) {
    throw new Error(
      `Unknown CLOUD_IDENTIFIER "${config.CLOUD_IDENTIFIER}". Expected one of ${Object.keys(ISSUERS).join(', ')}.`
    );
  }

  const verify = createSessionMiddleware({
    audience: config.sessionAudience,
    issuer,
    audiencePolicy: 'forward-url-origin',
  }) as unknown as RequestHandler;

  /**
   * Every failure path inside the verifier throws a plain Error — a missing proxy header, a
   * missing bearer token, a bad signature, a wrong audience or issuer, an expired token.
   * Left alone those surface as HTTP 500, which is both wrong and actively harmful: it
   * pages someone for what is really just an unauthenticated request, and it invites a
   * stack trace into the response. Translate the whole class to 401 here.
   */
  return (req: Request, res: Response, next: NextFunction) => {
    verify(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      req.log?.warn('session verification failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      next(Object.assign(new Error('unauthenticated'), { statusCode: 401, cause: error }));
    });
  };
};
