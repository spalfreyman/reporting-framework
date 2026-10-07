/**
 * A minimal vitest-compatible shim over Node's built-in test runner.
 *
 * The apps were migrated off vitest because its transitive dependencies (vite → postcss →
 * source-map-js, and tinypool) are flagged by Connect's software-composition analysis, which
 * scans devDependencies too. `node:test` + `node:assert` ship with the runtime and add no
 * dependencies. This shim re-exposes just the slice of the vitest API the tests use, so the
 * test files only needed their import line changed.
 *
 * Run with:  node --import tsx --test "tests/*.test.ts"
 */
import { describe, it, before, beforeEach as nodeBeforeEach, afterEach as nodeAfterEach } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

export { describe, it };
export const test = it;
export const beforeAll = before;
export const beforeEach = nodeBeforeEach;
export const afterEach = nodeAfterEach;

type AnyFn = (...args: unknown[]) => unknown;

/** vitest's `vi`, reduced to `vi.fn()` with the `.mock.calls` shape the tests read. */
export const vi = {
  fn(impl?: AnyFn) {
    const calls: unknown[][] = [];
    const results: unknown[] = [];
    const f = (...args: unknown[]): unknown => {
      calls.push(args);
      const r = impl ? impl(...args) : undefined;
      results.push(r);
      return r;
    };
    (f as unknown as { mock: { calls: unknown[][]; results: unknown[] } }).mock = { calls, results };
    return f;
  },
};

const fmt = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Recursive subset match, matching vitest's `toMatchObject`. */
const matchObject = (actual: unknown, expected: unknown): boolean => {
  if (expected === null || typeof expected !== 'object') return isDeepStrictEqual(actual, expected);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((e, i) => matchObject((actual as unknown[])[i], e));
  }
  if (actual === null || typeof actual !== 'object') return false;
  return Object.keys(expected as Record<string, unknown>).every((k) =>
    matchObject((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k])
  );
};

type Asymmetric = { __asymmetric: true; match: (value: unknown) => boolean };
const isAsymmetric = (v: unknown): v is Asymmetric =>
  typeof v === 'object' && v !== null && (v as { __asymmetric?: unknown }).__asymmetric === true;

const matchAny = (value: unknown, ctor: unknown): boolean => {
  if (ctor === String) return typeof value === 'string';
  if (ctor === Number) return typeof value === 'number';
  if (ctor === Boolean) return typeof value === 'boolean';
  if (ctor === Object) return typeof value === 'object' && value !== null;
  if (ctor === Array) return Array.isArray(value);
  if (ctor === Function) return typeof value === 'function';
  try {
    return value instanceof (ctor as new () => unknown);
  } catch {
    return false;
  }
};

/** Matcher-aware deep equality, so asymmetric matchers (`expect.any`) work inside structures. */
const deepEqualM = (actual: unknown, expected: unknown): boolean => {
  if (isAsymmetric(expected)) return expected.match(actual);
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((e, i) => deepEqualM((actual as unknown[])[i], e));
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const ek = Object.keys(expected as Record<string, unknown>);
  const ak = Object.keys(actual as Record<string, unknown>);
  if (ek.length !== ak.length) return false;
  return ek.every((k) =>
    deepEqualM((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k])
  );
};

const errMatches = (err: unknown, expected: unknown): boolean => {
  if (expected === undefined) return true;
  if (typeof expected === 'function') return err instanceof (expected as new () => unknown);
  const message = err instanceof Error ? err.message : String(err);
  if (expected instanceof RegExp) return expected.test(message);
  return message.includes(String(expected));
};

const fail = (message: string): never => {
  throw new Error(message);
};

const syncMatchers = (actual: unknown, negated: boolean) => {
  const ok = (pass: boolean, message: string): void => {
    if (pass === negated) fail(negated ? `Expected NOT: ${message}` : message);
  };
  return {
    toBe: (expected: unknown) => ok(Object.is(actual, expected), `expected ${fmt(actual)} to be ${fmt(expected)}`),
    toEqual: (expected: unknown) => ok(isDeepStrictEqual(actual, expected), `expected ${fmt(actual)} to equal ${fmt(expected)}`),
    toStrictEqual: (expected: unknown) => ok(isDeepStrictEqual(actual, expected), `expected ${fmt(actual)} to strictly equal ${fmt(expected)}`),
    toMatchObject: (expected: unknown) => ok(matchObject(actual, expected), `expected ${fmt(actual)} to match object ${fmt(expected)}`),
    toContain: (item: unknown) =>
      ok(
        typeof actual === 'string'
          ? actual.includes(String(item))
          : Array.isArray(actual) && actual.includes(item),
        `expected ${fmt(actual)} to contain ${fmt(item)}`
      ),
    toContainEqual: (expected: unknown) =>
      ok(
        Array.isArray(actual) && actual.some((el) => deepEqualM(el, expected)),
        `expected ${fmt(actual)} to contain an element equal to ${fmt(expected)}`
      ),
    toMatch: (re: RegExp | string) =>
      ok(
        typeof actual === 'string' && (typeof re === 'string' ? actual.includes(re) : re.test(actual)),
        `expected ${fmt(actual)} to match ${String(re)}`
      ),
    toHaveLength: (n: number) =>
      ok(
        actual != null && (actual as { length?: number }).length === n,
        `expected ${fmt(actual)} to have length ${n}`
      ),
    toBeNull: () => ok(actual === null, `expected ${fmt(actual)} to be null`),
    toBeUndefined: () => ok(actual === undefined, `expected ${fmt(actual)} to be undefined`),
    toBeDefined: () => ok(actual !== undefined, `expected ${fmt(actual)} to be defined`),
    toBeTruthy: () => ok(Boolean(actual), `expected ${fmt(actual)} to be truthy`),
    toBeFalsy: () => ok(!actual, `expected ${fmt(actual)} to be falsy`),
    toBeGreaterThan: (n: number) => ok((actual as number) > n, `expected ${fmt(actual)} > ${n}`),
    toBeGreaterThanOrEqual: (n: number) => ok((actual as number) >= n, `expected ${fmt(actual)} >= ${n}`),
    toBeLessThan: (n: number) => ok((actual as number) < n, `expected ${fmt(actual)} < ${n}`),
    toBeLessThanOrEqual: (n: number) => ok((actual as number) <= n, `expected ${fmt(actual)} <= ${n}`),
    toThrow: (expected?: unknown) => {
      let threw = false;
      let err: unknown;
      try {
        (actual as AnyFn)();
      } catch (e) {
        threw = true;
        err = e;
      }
      if (!threw) {
        ok(false, 'expected function to throw');
        return;
      }
      ok(errMatches(err, expected), `expected throw to match ${String(expected)}`);
    },
  };
};

const asyncMatchers = (promise: Promise<unknown>) => {
  const settle = async (): Promise<{ threw: boolean; err: unknown }> => {
    try {
      await promise;
      return { threw: false, err: undefined };
    } catch (e) {
      return { threw: true, err: e };
    }
  };
  return {
    async toThrow(expected?: unknown) {
      const { threw, err } = await settle();
      if (!threw) fail('expected promise to reject');
      if (!errMatches(err, expected)) fail(`rejection did not match ${String(expected)}`);
    },
    async toMatchObject(expected: unknown) {
      const { threw, err } = await settle();
      if (!threw) fail('expected promise to reject');
      if (!matchObject(err, expected)) fail(`rejection ${fmt(err)} did not match ${fmt(expected)}`);
    },
  };
};

export const expect = Object.assign(
  (actual: unknown) => ({
    ...syncMatchers(actual, false),
    not: syncMatchers(actual, true),
    rejects: asyncMatchers(actual as Promise<unknown>),
    resolves: {
      async toEqual(expected: unknown) {
        const value = await (actual as Promise<unknown>);
        if (!isDeepStrictEqual(value, expected)) fail(`expected ${fmt(value)} to equal ${fmt(expected)}`);
      },
    },
  }),
  {
    any: (ctor: unknown): Asymmetric => ({ __asymmetric: true, match: (v) => matchAny(v, ctor) }),
    anything: (): Asymmetric => ({ __asymmetric: true, match: (v) => v !== null && v !== undefined }),
    stringContaining: (s: string): Asymmetric => ({
      __asymmetric: true,
      match: (v) => typeof v === 'string' && v.includes(s),
    }),
    objectContaining: (obj: Record<string, unknown>): Asymmetric => ({
      __asymmetric: true,
      match: (v) => matchObject(v, obj),
    }),
  }
);

// ── supertest-style HTTP shim ───────────────────────────────────────────────────────
// Replaces `supertest`, which pulls the app's HTTP framework into tests. Works with either a
// Hono app (dispatched in-process via `app.request()`, no socket) or a Node `http.Server`
// (booted once on an ephemeral port, then `fetch`ed). The server is `unref`'d so a listening
// instance never keeps the test runner's event loop alive.

type HonoLike = { request: (input: string, init?: RequestInit) => Promise<Response> };
type NodeServerLike = {
  listen: (port: number, cb?: () => void) => unknown;
  address: () => { port: number } | string | null;
  unref?: () => unknown;
};
type AppLike = HonoLike | NodeServerLike;

const isHono = (app: AppLike): app is HonoLike =>
  typeof (app as HonoLike).request === 'function';

const serverPorts = new WeakMap<object, Promise<number>>();
const ensureListening = (server: NodeServerLike): Promise<number> => {
  let pending = serverPorts.get(server);
  if (!pending) {
    pending = new Promise<number>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        server.unref?.();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    serverPorts.set(server, pending);
  }
  return pending;
};

interface TestResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

class RequestBuilder implements PromiseLike<TestResponse> {
  private headers: Record<string, string> = {};
  private payload: unknown;
  constructor(
    private readonly app: AppLike,
    private readonly method: string,
    private readonly path: string
  ) {}

  // Accepts both supertest forms: `.set({ a: '1' })` and `.set('a', '1')`.
  set(keyOrHeaders: string | Record<string, string>, value?: string): this {
    if (typeof keyOrHeaders === 'string') this.headers[keyOrHeaders] = value ?? '';
    else Object.assign(this.headers, keyOrHeaders);
    return this;
  }

  send(body: unknown): this {
    this.payload = body;
    this.headers['content-type'] = this.headers['content-type'] ?? 'application/json';
    return this;
  }

  private buildInit(): RequestInit {
    const init: RequestInit = { method: this.method, headers: this.headers };
    if (this.payload !== undefined) {
      init.body = typeof this.payload === 'string' ? this.payload : JSON.stringify(this.payload);
    }
    return init;
  }

  private async exec(): Promise<TestResponse> {
    const res = isHono(this.app)
      ? await this.app.request(this.path, this.buildInit())
      : await fetch(`http://127.0.0.1:${await ensureListening(this.app)}${this.path}`, this.buildInit());

    const text = await res.text();
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = { raw: text };
      }
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, body, headers };
  }

  then<R1 = TestResponse, R2 = never>(
    onfulfilled?: ((value: TestResponse) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export const request = (app: AppLike) => ({
  get: (path: string) => new RequestBuilder(app, 'GET', path),
  post: (path: string) => new RequestBuilder(app, 'POST', path),
  put: (path: string) => new RequestBuilder(app, 'PUT', path),
  delete: (path: string) => new RequestBuilder(app, 'DELETE', path),
});
