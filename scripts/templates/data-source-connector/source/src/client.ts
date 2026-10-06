import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { readConfiguration } from './env.js';
import { buildApiRoot, createCustomObjectPort as adapt } from './shared-node/ct-adapter.js';
import type { CustomObjectPort } from './shared/ct/ports.js';

/**
 * commercetools client — used ONLY for descriptor self-registration (postDeploy) and
 * withdrawal (preUndeploy). This sample's query path needs no commercetools access because
 * it generates its data locally; a real connector that caches results in Custom Objects
 * would reuse this port on the query path too.
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

export const getCustomObjectPort = (): CustomObjectPort => adapt(getApiRoot());
