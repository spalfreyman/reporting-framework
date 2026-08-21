import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { readConfiguration } from '../env.js';
import { buildApiRoot, createCustomObjectPort as adapt } from '../shared-node/ct-adapter.js';
import type { CustomObjectPort } from '../shared/ct/ports.js';

/**
 * The gateway's commercetools client. The SDK adapter itself lives in `shared-node/` so
 * every backend app shares one implementation of the Custom Object port semantics — in
 * particular surfacing a 409 as ConcurrentModificationError, which the job lock depends on.
 */

export const getApiRoot = (): ByProjectKeyRequestBuilder => {
  const config = readConfiguration();
  return buildApiRoot({
    projectKey: config.CTP_PROJECT_KEY,
    clientId: config.CTP_CLIENT_ID,
    clientSecret: config.CTP_CLIENT_SECRET,
    scopes: config.CTP_SCOPE.split(' ').filter(Boolean),
    authUrl: config.authUrl,
    apiUrl: config.apiUrl,
  });
};

export const createCustomObjectPort = (
  root: ByProjectKeyRequestBuilder = getApiRoot()
): CustomObjectPort => adapt(root);
