import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { GRAPHQL_TARGETS } from '@commercetools-frontend/constants';
import { useMcQuery } from '@commercetools-frontend/application-shell';
import type { ApolloError } from '@apollo/client';
import FetchGatewayConfig from './fetch-gateway-config.ctp.graphql';

/**
 * Discovers the reporting gateway's URL.
 *
 * The Merchant Center app is a static bundle, so it cannot be told the gateway URL at build
 * time. Rather than making an operator paste it and redeploy, the gateway writes its own
 * Connect-injected URL to Custom Object `reporting.config/gateway` during postDeploy and we
 * read it here. That is what makes the whole connector a single-pass deploy.
 *
 * `additionalEnv.reportingGatewayUrl` remains an override for local development and for
 * pointing at a gateway that is not hosted on Connect.
 */

type GatewayConfigValue = {
  url?: string;
  audience?: string;
  deployedAt?: string;
};

type QueryResult = {
  customObject: {
    id: string;
    version: number;
    value: GatewayConfigValue;
  } | null;
};

export type UseGatewayUrlResult = {
  gatewayUrl: string;
  isConfigured: boolean;
  loading: boolean;
  error?: ApolloError;
  /** True when the URL came from additionalEnv rather than from the published Custom Object. */
  overridden: boolean;
};

export const useGatewayUrl = (): UseGatewayUrlResult => {
  const override = useApplicationContext(
    (context) =>
      (context.environment as { reportingGatewayUrl?: string })
        .reportingGatewayUrl || ''
  );

  const { data, loading, error } = useMcQuery<QueryResult>(FetchGatewayConfig, {
    context: { target: GRAPHQL_TARGETS.COMMERCETOOLS_PLATFORM },
    // Skip the round trip entirely when an override is present.
    skip: Boolean(override),
    fetchPolicy: 'cache-first',
  });

  const discovered = data?.customObject?.value?.url ?? '';
  const gatewayUrl = (override || discovered).replace(/\/$/, '');

  return {
    gatewayUrl,
    isConfigured: gatewayUrl.length > 0,
    loading: Boolean(override) ? false : loading,
    ...(error ? { error } : {}),
    overridden: Boolean(override),
  };
};
