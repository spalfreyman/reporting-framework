/**
 * In-process LRU cache with stale-while-revalidate.
 *
 * Deliberately NOT a shared L2. Connect provides no Redis, and a general Custom Object
 * cache would spend the project's object budget on write amplification for marginal gain.
 * Caching belongs close to the scarce resource instead: the GA4 connector caches its own
 * GA4 responses, and rollup reads are already point reads by key.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

export class MemoryCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): { value: T; stale: boolean } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const current = this.now();
    if (current >= entry.staleUntil) {
      this.entries.delete(key);
      return null;
    }
    // Refresh recency for LRU ordering.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value, stale: current >= entry.expiresAt };
  }

  set(key: string, value: T, ttlSeconds: number, staleWhileRevalidateSeconds = 0): void {
    const current = this.now();
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: current + ttlSeconds * 1000,
      staleUntil: current + (ttlSeconds + staleWhileRevalidateSeconds) * 1000,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
