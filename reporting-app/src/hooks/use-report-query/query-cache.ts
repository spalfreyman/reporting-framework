import type { RunReportResponse } from '../../types/reporting';

/**
 * A small in-tab cache, so flipping between two reports or nudging a filter back and forth
 * does not re-run the whole fan-out. The gateway caches too; this just avoids the round
 * trip.
 */

type Entry = { value: RunReportResponse; expiresAt: number };

const MAX_ENTRIES = 40;
const entries = new Map<string, Entry>();

export const getCached = (key: string): RunReportResponse | null => {
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    entries.delete(key);
    return null;
  }
  // Refresh recency for LRU ordering.
  entries.delete(key);
  entries.set(key, entry);
  return entry.value;
};

export const setCached = (
  key: string,
  value: RunReportResponse,
  ttlSeconds: number
): void => {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
};

export const clearCache = (): void => entries.clear();
