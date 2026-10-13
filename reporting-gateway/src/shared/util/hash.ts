/**
 * Stable, dependency-free hashing for cache keys.
 * Not cryptographic — it only needs to be deterministic and collision-resistant enough.
 */

/** Canonical JSON: object keys sorted recursively, so key order never changes the hash. */
export const canonicalJson = (value: unknown): string => {
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    if (node instanceof Set) return [...node].map(String).sort();
    if (node instanceof Map) {
      return Object.fromEntries([...node.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
    }
    const entries = Object.entries(node as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([k, v]) => [k, walk(v)]));
  };
  return JSON.stringify(walk(value));
};

/** FNV-1a, 32-bit, doubled with a second offset basis for a wider key. */
export const stableHash = (value: unknown): string => {
  const input = canonicalJson(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};
