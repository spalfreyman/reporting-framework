import { ClientBuilder, type Client } from '@commercetools/ts-client';
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';
import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import {
  ConcurrentModificationError,
  type CustomObject,
  type CustomObjectPage,
  type CustomObjectPort,
  type KeysetPage,
  type OrderScanPort,
} from '../shared/ct/ports.js';
import { keysetPredicate } from '../shared/ct/keyset.js';

/**
 * The commercetools SDK adapter, shared by every backend app.
 *
 * It lives in `shared-node/` rather than `shared/` because it depends on the SDK, and
 * `shared/` is bundled into the webpack-built Merchant Center app where that dependency has
 * no business being.
 *
 * NOTE on the relative imports below: they are written for the COPIED layout, where
 * sync-shared places this file at `<app>/src/shared-node/` beside `<app>/src/shared/`.
 * That means this folder is not typechecked standalone — every consuming app typechecks it
 * after the copy, which is what CI relies on.
 */

export interface CtClientConfig {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authUrl: string;
  apiUrl: string;
}

const roots = new Map<string, ByProjectKeyRequestBuilder>();

/**
 * Builds `apiRoot` ONCE per configuration and reuses it. Rebuilding per request re-does the
 * OAuth handshake and leaks sockets.
 */
export const buildApiRoot = (config: CtClientConfig): ByProjectKeyRequestBuilder => {
  const cacheKey = `${config.apiUrl}|${config.projectKey}|${config.clientId}`;
  const existing = roots.get(cacheKey);
  if (existing) return existing;

  const client: Client = new ClientBuilder()
    .withProjectKey(config.projectKey)
    .withClientCredentialsFlow({
      host: config.authUrl,
      projectKey: config.projectKey,
      credentials: { clientId: config.clientId, clientSecret: config.clientSecret },
      scopes: config.scopes,
      httpClient: fetch,
    })
    .withHttpMiddleware({ host: config.apiUrl, httpClient: fetch })
    .build();

  const root = createApiBuilderFromCtpClient(client).withProjectKey({
    projectKey: config.projectKey,
  });
  roots.set(cacheKey, root);
  return root;
};

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: number }).statusCode)
    : undefined;

/**
 * Adapts the SDK to the narrow CustomObjectPort that `shared/` depends on.
 *
 * Crucially it surfaces a 409 as ConcurrentModificationError rather than swallowing it: the
 * job lock and the order-facts writer both depend on losing that race.
 */
export const createCustomObjectPort = (root: ByProjectKeyRequestBuilder): CustomObjectPort => ({
  async get<T>(container: string, key: string) {
    try {
      const response = await root
        .customObjects()
        .withContainerAndKey({ container, key })
        .get()
        .execute();
      return response.body as unknown as CustomObject<T>;
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  },

  async put<T>(container: string, key: string, value: T, version?: number) {
    try {
      const response = await root
        .customObjects()
        .post({
          body: {
            container,
            key,
            value: value as never,
            ...(version === undefined ? {} : { version }),
          },
        })
        .execute();
      return response.body as unknown as CustomObject<T>;
    } catch (error) {
      if (statusOf(error) === 409) throw new ConcurrentModificationError(container, key);
      throw error;
    }
  },

  async delete(container: string, key: string) {
    try {
      await root.customObjects().withContainerAndKey({ container, key }).delete().execute();
    } catch (error) {
      // Deleting something already gone is the desired end state, not a failure.
      if (statusOf(error) !== 404) throw error;
    }
  },

  async query<T>(
    container: string,
    options: { where?: string; sort?: string[]; limit?: number; offset?: number } = {}
  ) {
    const response = await root
      .customObjects()
      .withContainer({ container })
      .get({
        queryArgs: {
          ...(options.where ? { where: options.where } : {}),
          ...(options.sort ? { sort: options.sort } : {}),
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
        },
      })
      .execute();
    return response.body as unknown as CustomObjectPage<T>;
  },
});

export interface ScannedOrder {
  id: string;
  lastModifiedAt: string;
  [key: string]: unknown;
}

/**
 * Keyset order scanning.
 *
 * NEVER `offset`. The platform caps offset at 10,000 and caps `total` at the max offset for
 * predicated queries, so an offset walk silently truncates real order history instead of
 * failing — which is far worse.
 *
 * Fetched via GraphQL because payload size dominates runtime at 2 CPU / 4 GB, and a rollup
 * needs roughly twenty fields out of an order rather than the whole document.
 */
export const createOrderScanPort = (
  root: ByProjectKeyRequestBuilder,
  graphqlSelection: string
): OrderScanPort<ScannedOrder> => ({
  async scan({ afterLastModifiedAt, afterId, until, limit }) {
    const { where, sort, vars } = keysetPredicate(afterLastModifiedAt, afterId, until);

    /**
     * commercetools GraphQL does NOT bind predicate placeholders (`:until`) to GraphQL
     * variables — a placeholder only referenced inside the `where` STRING reads as an unused
     * GraphQL variable and the query is rejected. So the predicate values are inlined as
     * quoted literals here. Only `where`, `sort` and `limit` are true GraphQL arguments.
     *
     * The values are timestamps and UUIDs (never user input), but they are escaped anyway so
     * this cannot become an injection vector if the cursor source ever changes.
     */
    const escape = (value: string): string => value.replace(/["\\]/g, '\\$&');
    const inlinedWhere = Object.entries(vars).reduce(
      (predicate, [name, value]) =>
        predicate.replace(new RegExp(`:${name}\\b`, 'g'), `"${escape(value)}"`),
      where
    );

    const query = `
      query ScanOrders($where: String!, $sort: [String!], $limit: Int!) {
        orders(where: $where, sort: $sort, limit: $limit) {
          results {
            ${graphqlSelection}
          }
        }
      }
    `;

    const response = await root
      .graphql()
      .post({
        body: {
          query,
          variables: { where: inlinedWhere, sort, limit },
        },
      })
      .execute();

    const body = response.body as {
      errors?: Array<{ message: string }>;
      data?: { orders?: { results?: ScannedOrder[] } };
    };
    if (body.errors?.length) {
      throw new Error(`Order scan GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return { results: body.data?.orders?.results ?? [] } satisfies KeysetPage<ScannedOrder>;
  },
});
