import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { readConfiguration } from './env.js';
import {
  buildApiRoot,
  createCustomObjectPort as adapt,
  createOrderScanPort,
} from './shared-node/ct-adapter.js';
import type { CustomObjectPort } from './shared/ct/ports.js';

/** The GraphQL selection for an order — exactly the fields the rollup needs, no more. */
export const ORDER_SELECTION = `
  id
  version
  createdAt
  completedAt
  lastModifiedAt
  orderState
  country
  totalPrice { currencyCode centAmount fractionDigits }
  taxedPrice { totalNet { centAmount } totalGross { centAmount } totalTax { centAmount } }
  shippingInfo { price { centAmount } }
  store { key }
  customerId
  discountCodes { discountCode { id } }
  lineItems {
    quantity
    productId
    variant { sku }
    distributionChannel { key }
    totalPrice { centAmount }
  }
`;

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
export const getOrderScanPort = () => createOrderScanPort(getApiRoot(), ORDER_SELECTION);
