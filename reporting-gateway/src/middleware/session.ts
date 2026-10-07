import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { readConfiguration } from '../env.js';
import type { Env, SessionClaims } from '../http-context.js';
import { GatewayError } from './error.js';

/**
 * Verifies the Merchant Center exchange JWT.
 *
 * The Merchant Center app never holds a credential. It calls the MC API Gateway's
 * `/proxy/forward-to` endpoint, which mints a short-lived signed token carrying the
 * logged-in user's identity, project and — because the app sets `includeUserPermissions` —
 * their Merchant Center permissions. This middleware is the only thing that makes those
 * claims trustworthy, so everything downstream depends on it.
 *
 * This is a direct, dependency-free reimplementation of
 * `@commercetools-backend/express`'s `createSessionMiddleware` on top of `jose`. That package
 * is otherwise excellent, but it pulls Express (and so `proxy-addr`) into the deployed tree,
 * which Connect's software-composition analysis flags. The verification is identical:
 *
 *  - Requires the two headers only `/proxy/forward-to` sets (`X-MC-API-Cloud-Identifier` and
 *    `X-MC-API-Forward-To-Version`) and an `authorization: Bearer <jwt>`.
 *  - Pins the algorithm to RS256, so an `alg: none` token is rejected outright.
 *  - Checks `audience` (ORIGIN ONLY, matching the `forward-url-origin` policy the app sends)
 *    and `issuer` (the cloud the project lives in), verifying the signature against that
 *    issuer's JWKS.
 *  - On success, reads `userId` (the JWT `sub`), `projectKey` and, when present,
 *    `userPermissions` from the issuer-namespaced public claims.
 *
 * Every failure path throws, and the caller maps the whole class to a 401.
 */

// New MC API hostnames by cloud identifier. Mirrors @commercetools-backend/express.
const MC_API_URLS: Record<string, string> = {
  'gcp-au': 'https://mc-api.australia-southeast1.gcp.commercetools.com',
  'gcp-eu': 'https://mc-api.europe-west1.gcp.commercetools.com',
  'gcp-us': 'https://mc-api.us-central1.gcp.commercetools.com',
  'aws-eu': 'https://mc-api.eu-central-1.aws.commercetools.com',
  'aws-us': 'https://mc-api.us-east-2.aws.commercetools.com',
};

// Legacy hostnames, used only when a client still forwards `X-MC-API-Forward-To-Version: v1`.
const LEGACY_ISSUERS: Record<string, string> = {
  'gcp-eu': 'https://mc-api.commercetools.com',
  'gcp-us': 'https://mc-api.commercetools.co',
};

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const jwksFor = (issuer: string): ReturnType<typeof createRemoteJWKSet> => {
  let client = jwksByIssuer.get(issuer);
  if (!client) {
    client = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer));
    jwksByIssuer.set(issuer, client);
  }
  return client;
};

const verifySession = async (headers: Headers): Promise<SessionClaims> => {
  const config = readConfiguration();

  // Both headers are set only by `/proxy/forward-to`; their absence is an unauthenticated call.
  const cloudIdentifier = headers.get('x-mc-api-cloud-identifier');
  if (!cloudIdentifier) throw new Error('Missing "X-MC-API-Cloud-Identifier" header.');
  const forwardVersion = headers.get('x-mc-api-forward-to-version');
  if (!forwardVersion) throw new Error('Missing "X-MC-API-Forward-To-Version" header.');

  // The issuer is the configured cloud, not the header (we do not infer issuer from the
  // caller). A v1 forward falls back to the legacy issuer domain.
  let issuer = MC_API_URLS[config.CLOUD_IDENTIFIER];
  if (forwardVersion === 'v1') {
    issuer = LEGACY_ISSUERS[config.CLOUD_IDENTIFIER] ?? issuer;
  }

  // `forward-url-origin` policy: the audience is the origin of the configured service URL.
  const audience = config.sessionAudience;

  const authorization = headers.get('authorization');
  if (typeof authorization !== 'string') throw new Error('Missing "authorization" header');
  const token = authorization.replace(/^Bearer (.*)$/, '$1');

  const { payload } = await jwtVerify(token, jwksFor(issuer), {
    algorithms: ['RS256'],
    audience,
    issuer,
  });

  const iss = payload.iss;
  const claims: SessionClaims = {
    userId: typeof payload.sub === 'string' ? payload.sub : undefined,
    projectKey: payload[`${iss}/claims/project_key`] as string | undefined,
  };
  const userPermissions = payload[`${iss}/claims/user_permissions`];
  if (Array.isArray(userPermissions) && userPermissions.length > 0) {
    claims.userPermissions = userPermissions as string[];
  }
  return claims;
};

export const sessionMiddleware = (): MiddlewareHandler<Env> => {
  const config = readConfiguration();
  if (!MC_API_URLS[config.CLOUD_IDENTIFIER]) {
    throw new Error(
      `Unknown CLOUD_IDENTIFIER "${config.CLOUD_IDENTIFIER}". Expected one of ${Object.keys(MC_API_URLS).join(', ')}.`
    );
  }

  return async (c, next) => {
    try {
      c.set('session', await verifySession(c.req.raw.headers));
    } catch (error) {
      c.get('log')?.warn('session verification failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      throw new GatewayError(401, 'unauthenticated', error);
    }
    await next();
  };
};
