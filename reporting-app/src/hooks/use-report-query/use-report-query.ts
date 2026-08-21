import { useCallback, useEffect, useRef, useState } from 'react';
import { actions, useAsyncDispatch } from '@commercetools-frontend/sdk';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { useGatewayUrl } from '../use-gateway-url';
import { stableHash } from '../../shared/util/hash';
import { getCached, setCached } from './query-cache';
import type {
  RunReportRequest,
  RunReportResponse,
} from '../../types/reporting';

/**
 * Runs a report through the gateway.
 *
 * Everything goes through the Merchant Center API Gateway's `/proxy/forward-to` endpoint, so
 * no credential is ever present in the browser. That endpoint mints a short-lived signed
 * token carrying the logged-in user's identity, project and — because we set
 * `includeUserPermissions` — their Merchant Center permissions. The gateway verifies that
 * token and derives the access frame from it, which is why authorisation cannot be bypassed
 * by tampering with this request.
 *
 * ONE round trip per report, not per tile: the gateway fans out to the data sources and
 * returns every tile together, so a twelve-tile dashboard costs one request.
 */

type State = {
  data?: RunReportResponse;
  loading: boolean;
  error?: Error;
};

export type UseReportQueryResult = State & {
  run: (
    request: RunReportRequest,
    options?: { bypassCache?: boolean }
  ) => Promise<void>;
  refetch: () => Promise<void>;
  isConfigured: boolean;
};

export const useReportQuery = (
  reportId: string | undefined,
  request: RunReportRequest
): UseReportQueryResult => {
  const dispatch = useAsyncDispatch();
  const { gatewayUrl, isConfigured } = useGatewayUrl();

  const audiencePolicy = useApplicationContext(
    (context) =>
      (context.environment as { forwardToAudiencePolicy?: string })
        .forwardToAudiencePolicy ?? 'forward-url-origin'
  );

  const [state, setState] = useState<State>({ loading: false });
  /** Guards against a slower earlier request overwriting a newer one's result. */
  const latest = useRef<string | null>(null);

  const run = useCallback(
    async (
      nextRequest: RunReportRequest,
      options?: { bypassCache?: boolean }
    ) => {
      if (!reportId) return;

      if (!isConfigured) {
        setState({
          loading: false,
          error: new Error(
            'The reporting gateway has not published its URL yet. Deploy the reporting ' +
              'connector, or set REPORTING_GATEWAY_URL for local development.'
          ),
        });
        return;
      }

      const key = stableHash({ reportId, nextRequest, gatewayUrl });

      if (!options?.bypassCache) {
        const cached = getCached(key);
        if (cached) {
          latest.current = key;
          setState({ data: cached, loading: false });
          return;
        }
      }

      latest.current = key;
      setState((previous) => ({
        ...previous,
        loading: true,
        error: undefined,
      }));

      try {
        const response = (await dispatch(
          actions.forwardTo.post({
            uri: `${gatewayUrl}/gateway/reports/${encodeURIComponent(
              reportId
            )}/run`,
            payload: nextRequest,
            audiencePolicy: audiencePolicy as 'forward-url-origin',
            // Puts the user's MC permissions into the signed exchange token. This is the
            // whole basis of server-side role framing.
            includeUserPermissions: true,
          })
        )) as RunReportResponse;

        // A superseded request must not clobber the current view.
        if (latest.current !== key) return;

        // Never cache a failed or partial run for long: the gap is usually transient.
        setCached(key, response, response.status === 'ok' ? 120 : 15);
        setState({ data: response, loading: false });
      } catch (error) {
        if (latest.current !== key) return;
        setState({
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    },
    [audiencePolicy, dispatch, gatewayUrl, isConfigured, reportId]
  );

  const requestKey = stableHash(request);

  useEffect(() => {
    if (reportId && isConfigured) void run(request, undefined);
    // `requestKey` is a stable hash of the request, so this re-runs on a real filter change
    // rather than on every render that happens to build a new object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, requestKey, isConfigured, run]);

  const refetch = useCallback(
    () => run(request, { bypassCache: true }),
    [run, request]
  );

  return { ...state, run, refetch, isConfigured };
};
