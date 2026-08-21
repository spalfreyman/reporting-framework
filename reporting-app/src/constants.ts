// Must be imported from the `ssr` entry point.
import { entryPointUriPathToPermissionKeys } from '@commercetools-frontend/application-shell/ssr';

export const entryPointUriPath = 'reporting';

/**
 * Reading a report, authoring one, and administering data sources are three different jobs,
 * so they get three permission groups that a Team can grant independently. The groups here
 * must match `additionalOAuthScopes` in custom-application-config.mjs.
 *
 * Yields: View / Manage, ViewBuilder / ManageBuilder, ViewDatasources / ManageDatasources.
 */
export const PERMISSIONS = entryPointUriPathToPermissionKeys(
  entryPointUriPath,
  ['builder', 'datasources']
);

export const APP_NAME = 'Reporting';

/**
 * The audience policy must match what the gateway verifies. `forward-url-origin` keeps the
 * exchange-token audience equal to the gateway's origin regardless of path, so the gateway
 * configures a single stable audience value.
 */
export const FORWARD_TO_AUDIENCE_POLICY = 'forward-url-origin' as const;
