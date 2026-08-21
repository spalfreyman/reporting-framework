import { useCallback, useEffect, useRef, useState } from 'react';
import { actions, useAsyncDispatch } from '@commercetools-frontend/sdk';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { useGatewayUrl } from '../use-gateway-url';

/**
 * A small GET helper for the gateway's read endpoints (the catalogue, a report definition,
 * the data-source list).
 *
 * Same trust model as `use-report-query`: everything goes through the Merchant Center API
 * Gateway's `/proxy/forward-to` endpoint with `includeUserPermissions`, so the gateway frames
 * the response from a verified token rather than from anything this client claims.
 */

type State<T> = {
  data?: T;
  loading: boolean;
  error?: Error;
};

export type UseGatewayFetchResult<T> = State<T> & {
  refetch: () => Promise<void>;
  isConfigured: boolean;
};

export const useGatewayFetch = <T>(
  path: string | null
): UseGatewayFetchResult<T> => {
  const dispatch = useAsyncDispatch();
  const { gatewayUrl, isConfigured, loading: discovering } = useGatewayUrl();
  const audiencePolicy = useApplicationContext(
    (context) =>
      (context.environment as { forwardToAudiencePolicy?: string })
        .forwardToAudiencePolicy ?? 'forward-url-origin'
  );

  const [state, setState] = useState<State<T>>({ loading: Boolean(path) });
  const latest = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;

    // Still discovering the gateway URL: stay in the loading state rather than flashing an
    // error that resolves itself a moment later.
    if (discovering) return;

    if (!isConfigured) {
      setState({ loading: false, error: new Error('GATEWAY_NOT_CONFIGURED') });
      return;
    }

    const key = `${gatewayUrl}${path}`;
    latest.current = key;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));

    try {
      const response = (await dispatch(
        actions.forwardTo.get({
          uri: `${gatewayUrl}${path}`,
          audiencePolicy: audiencePolicy as 'forward-url-origin',
          includeUserPermissions: true,
        })
      )) as T;

      if (latest.current !== key) return;
      setState({ data: response, loading: false });
    } catch (error) {
      if (latest.current !== key) return;
      setState({
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [audiencePolicy, discovering, dispatch, gatewayUrl, isConfigured, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refetch: load, isConfigured };
};
