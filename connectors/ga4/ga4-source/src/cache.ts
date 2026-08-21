import { CO } from './shared/schema/descriptor.js';
import type { CustomObjectPort } from './shared/ct/ports.js';
import type { ResultSet } from './shared/schema/query.js';
import { stableHash } from './shared/util/hash.js';

/**
 * A persistent GA4 result cache in a Custom Object container.
 *
 * The cache lives HERE, next to the scarce resource (the GA4 quota), rather than in the
 * gateway — which is exactly why the framework declines to build a general gateway L2. A
 * sealed historical period is immutable apart from GA4's own late attribution, so it caches
 * for hours; a range touching today caches for minutes.
 */
const CONTAINER = 'reporting.cache-ga4';

export interface CacheEntry {
  resultSet: ResultSet;
  storedAt: string;
  expiresAt: string;
}

export const cacheKeyFor = (sourceId: string, requestFingerprint: unknown): string =>
  `${sourceId}_${stableHash(requestFingerprint)}`;

export const readCache = async (
  port: CustomObjectPort,
  key: string,
  now: Date
): Promise<{ resultSet: ResultSet; stale: boolean } | null> => {
  const entry = await port.get<CacheEntry>(CONTAINER, key);
  if (!entry) return null;
  const stale = now.getTime() >= Date.parse(entry.value.expiresAt);
  return { resultSet: entry.value.resultSet, stale };
};

export const writeCache = async (
  port: CustomObjectPort,
  key: string,
  resultSet: ResultSet,
  ttlSeconds: number,
  now: Date
): Promise<void> => {
  const existing = await port.get<CacheEntry>(CONTAINER, key);
  const value: CacheEntry = {
    resultSet,
    storedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
  await port.put(CONTAINER, key, value, existing?.version);
};

export { CO };
