/**
 * Narrow ports over the commercetools API.
 *
 * `shared/` deliberately does NOT depend on @commercetools/platform-sdk: it is copied into
 * a webpack-built Merchant Center app as well as several Node services, and it must stay
 * free of a heavy Node-only dependency. Each app adapts its own `apiRoot` to these ports,
 * which also makes every helper below unit-testable with a plain fake.
 */

export interface CustomObject<T = unknown> {
  id: string;
  version: number;
  container: string;
  key: string;
  value: T;
  createdAt?: string;
  lastModifiedAt?: string;
}

export interface CustomObjectPage<T = unknown> {
  results: Array<CustomObject<T>>;
  total?: number;
  offset: number;
  count: number;
}

/** Thrown by an adapter when a create/update loses an optimistic-concurrency race. */
export class ConcurrentModificationError extends Error {
  constructor(
    readonly container: string,
    readonly key: string,
    readonly currentVersion?: number
  ) {
    super(`Concurrent modification of ${container}/${key}`);
    this.name = 'ConcurrentModificationError';
  }
}

export interface CustomObjectPort {
  get<T>(container: string, key: string): Promise<CustomObject<T> | null>;
  /**
   * Upsert. Passing `version` makes it a compare-and-swap: the adapter must surface a 409
   * as ConcurrentModificationError rather than swallowing it, because several callers here
   * depend on losing that race.
   */
  put<T>(
    container: string,
    key: string,
    value: T,
    version?: number
  ): Promise<CustomObject<T>>;
  delete(container: string, key: string): Promise<void>;
  /** One page. `where` uses commercetools query-predicate syntax. */
  query<T>(
    container: string,
    options?: { where?: string; sort?: string[]; limit?: number; offset?: number }
  ): Promise<CustomObjectPage<T>>;
}

/** A page of a keyset-paginated resource scan. */
export interface KeysetPage<T> {
  results: T[];
}

export interface OrderScanPort<T> {
  /**
   * Fetch up to `limit` orders after the cursor, sorted by (lastModifiedAt, id).
   *
   * Implementations MUST use a keyset predicate, never `offset` — the platform caps offset
   * at 10,000, which silently truncates any real order history.
   */
  scan(options: {
    afterLastModifiedAt: string | null;
    afterId: string | null;
    /** Exclusive upper bound, to avoid racing writes that are still settling. */
    until: string;
    limit: number;
  }): Promise<KeysetPage<T>>;
}
