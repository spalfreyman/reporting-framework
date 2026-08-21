import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { readConfiguration } from './env.js';
import { buildApiRoot, createCustomObjectPort as adapt } from './shared-node/ct-adapter.js';
import type { CustomObjectPort } from './shared/ct/ports.js';
import type { OrderProjection } from './shared/rollup/order-mapping.js';

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

/**
 * Re-fetches an order by id.
 *
 * The event contract says the message is a HINT, not the truth: it can be stale, out of
 * order, or delivered with no payload. Re-fetching the current order and recomputing the
 * fact from it is what makes redelivery a no-op.
 */
export const fetchOrder = async (
  root: ByProjectKeyRequestBuilder,
  orderId: string
): Promise<OrderProjection | null> => {
  try {
    const response = await root.orders().withId({ ID: orderId }).get().execute();
    return response.body as unknown as OrderProjection;
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : undefined;
    // A deleted order is a legitimate "nothing to do", not a failure.
    if (status === 404) return null;
    throw error;
  }
};
