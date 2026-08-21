import { PERMISSIONS, entryPointUriPath } from './src/constants';

/**
 * Every deploy-time value is an `${env:...}` placeholder rather than a literal, because
 * those placeholders are exactly what Connect injects from connect.yaml. The same repo then
 * deploys to any project without an edit.
 *
 * Note what is NOT here: no client credentials of any kind. The app reaches its backend
 * through the Merchant Center API Gateway's /proxy/forward-to endpoint, so no secret ever
 * enters the browser bundle.
 *
 * @type {import('@commercetools-frontend/application-config').ConfigOptionsForCustomApplication}
 */
const config = {
  name: 'Reporting',
  description:
    'Configurable ecommerce reporting across commercetools and connected sources.',
  entryPointUriPath,
  cloudIdentifier: '${env:CLOUD_IDENTIFIER}',

  env: {
    development: {
      initialProjectKey: '${env:INITIAL_PROJECT_KEY}',
    },
    production: {
      applicationId: '${env:CUSTOM_APPLICATION_ID}',
      // Injected by Connect. Deliberately NOT declared in connect.yaml.
      url: '${env:APPLICATION_URL}',
    },
  },

  /**
   * Least privilege: this is a read-only reporting tool. The only write scope is for saving
   * report definitions as Custom Objects. Asking for `manage_orders` here would put the
   * operator's whole order book inside the blast radius of a reporting bug.
   */
  oAuthScopes: {
    view: [
      'view_key_value_documents',
      'view_orders',
      'view_products',
      'view_customers',
      'view_stores',
      'view_cart_discounts',
      'view_discount_codes',
    ],
    manage: ['manage_key_value_documents'],
  },

  additionalOAuthScopes: [
    {
      name: 'builder',
      view: ['view_key_value_documents'],
      manage: ['manage_key_value_documents'],
    },
    {
      name: 'datasources',
      view: ['view_key_value_documents'],
      manage: ['manage_key_value_documents'],
    },
  ],

  additionalEnv: {
    /**
     * Optional override. Normally empty: the gateway publishes its own URL to Custom Object
     * `reporting.config/gateway` during postDeploy and the app discovers it at boot, which
     * is what makes the connector a single-pass deploy.
     */
    reportingGatewayUrl: '${env:REPORTING_GATEWAY_URL}',
    forwardToAudiencePolicy: 'forward-url-origin',
  },

  headers: {
    csp: {
      // Production traffic reaches the gateway via the MC API Gateway, which the shell
      // already allows. This entry is only for pointing at a local gateway in development.
      'connect-src': [
        "'self'",
        'http://localhost:8080',
        'https://localhost:8080',
      ],
    },
  },

  icon: '${path:@commercetools-frontend/assets/application-icons/stats.svg}',

  mainMenuLink: {
    defaultLabel: 'Reporting',
    labelAllLocales: [],
    permissions: [PERMISSIONS.View],
  },

  submenuLinks: [
    {
      uriPath: 'catalogue',
      defaultLabel: 'Report catalogue',
      labelAllLocales: [],
      permissions: [PERMISSIONS.View],
    },
    {
      uriPath: 'builder',
      defaultLabel: 'Report builder',
      labelAllLocales: [],
      permissions: [PERMISSIONS.ManageBuilder],
    },
    {
      uriPath: 'data-sources',
      defaultLabel: 'Data sources',
      labelAllLocales: [],
      permissions: [PERMISSIONS.ViewDatasources],
    },
  ],
};

export default config;
