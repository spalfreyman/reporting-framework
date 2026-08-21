import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runJob } from '../src/index.js';
import { resetConfiguration } from '../src/env.js';
import type {
  CustomObject,
  CustomObjectPage,
  CustomObjectPort,
} from '../src/shared/ct/ports.js';
import { ConcurrentModificationError } from '../src/shared/ct/ports.js';
import type { OrderFact } from '../src/shared/rollup/keying.js';
import type { ScannedOrder } from '../src/shared-node/ct-adapter.js';

/**
 * The rollup job processed real money data, so its correctness properties are worth pinning:
 * idempotency under re-run, the overlap lock, keyset pagination past a single page, and the
 * currency-preserving fold.
 */

const ENV = {
  CTP_PROJECT_KEY: 'sp-demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'manage_project:sp-demo',
  ROLLUP_TIMEZONE: 'UTC',
  ROLLUP_CUBES: 'orders-daily,order-lines-daily',
  ROLLUP_PAGE_SIZE: '2',
  LOG_LEVEL: 'error',
};

/** An in-memory CustomObjectPort with real optimistic-concurrency semantics. */
class FakePort implements CustomObjectPort {
  store = new Map<string, CustomObject>();
  private key(container: string, key: string) {
    return `${container}::${key}`;
  }
  async get<T>(container: string, key: string) {
    return (this.store.get(this.key(container, key)) as CustomObject<T>) ?? null;
  }
  async put<T>(container: string, key: string, value: T, version?: number) {
    const existing = this.store.get(this.key(container, key));
    if (existing && version !== undefined && existing.version !== version) {
      throw new ConcurrentModificationError(container, key, existing.version);
    }
    if (existing && version === undefined) {
      // create-only semantics used by the lock: a value already there is a conflict.
      throw new ConcurrentModificationError(container, key, existing.version);
    }
    const next: CustomObject = {
      id: this.key(container, key),
      version: (existing?.version ?? 0) + 1,
      container,
      key,
      value,
    };
    this.store.set(this.key(container, key), next);
    return next as CustomObject<T>;
  }
  async delete(container: string, key: string) {
    this.store.delete(this.key(container, key));
  }
  async query<T>(
    container: string,
    options: { where?: string; limit?: number; offset?: number } = {}
  ) {
    let results = [...this.store.values()].filter((o) => o.container === container);
    // Support the fold's `value(businessDate = "YYYY-MM-DD")` predicate.
    const match = options.where?.match(/businessDate = "([^"]+)"/);
    if (match) {
      results = results.filter(
        (o) => (o.value as { businessDate?: string }).businessDate === match[1]
      );
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return {
      results: results.slice(offset, offset + limit) as Array<CustomObject<T>>,
      offset,
      count: Math.min(limit, results.length),
      total: results.length,
    } satisfies CustomObjectPage<T>;
  }
}

const order = (
  id: string,
  over: Partial<ScannedOrder> = {}
): ScannedOrder => ({
  id,
  version: 1,
  lastModifiedAt: `2026-08-1${id.slice(-1)}T10:00:00.000Z`,
  createdAt: '2022-08-12T10:00:00.000Z',
  orderState: 'Complete',
  country: 'DE',
  totalPrice: { currencyCode: 'EUR', centAmount: 10000, fractionDigits: 2 },
  taxedPrice: {
    totalNet: { centAmount: 8403 },
    totalGross: { centAmount: 10000 },
    totalTax: { centAmount: 1597 },
  },
  lineItems: [{ quantity: 2, productId: 'p1', variant: { sku: 'SKU-1' }, totalPrice: { centAmount: 8403 } }],
  ...over,
});

/** A fake scanner that pages through a fixed order list with keyset semantics. */
const fakeScanner = (orders: ScannedOrder[]) => {
  const sorted = [...orders].sort((a, b) =>
    a.lastModifiedAt === b.lastModifiedAt
      ? a.id.localeCompare(b.id)
      : a.lastModifiedAt.localeCompare(b.lastModifiedAt)
  );
  return {
    calls: 0,
    async scan({
      afterLastModifiedAt,
      afterId,
      limit,
    }: {
      afterLastModifiedAt: string | null;
      afterId: string | null;
      until: string;
      limit: number;
    }) {
      this.calls += 1;
      const after = sorted.filter((o) => {
        if (!afterLastModifiedAt || !afterId) return true;
        if (o.lastModifiedAt > afterLastModifiedAt) return true;
        return o.lastModifiedAt === afterLastModifiedAt && o.id > afterId;
      });
      return { results: after.slice(0, limit) };
    },
  };
};

beforeEach(() => {
  resetConfiguration();
  Object.assign(process.env, ENV);
});

describe('rollup job', () => {
  it('folds scanned orders into day partitions, split by currency', async () => {
    const port = new FakePort();
    const scanner = fakeScanner([
      order('o1', { totalPrice: { currencyCode: 'EUR', centAmount: 10000, fractionDigits: 2 } }),
      order('o2', { totalPrice: { currencyCode: 'GBP', centAmount: 5000, fractionDigits: 2 } }),
    ]);

    const result = await runJob({ port, scanner, now: () => new Date('2026-08-21T00:00:00Z') });
    expect(result.skipped).toBe(false);
    expect(result.ordersProcessed).toBe(2);

    const partition = await port.get<{ rows: Array<{ k: Record<string, string>; m: Record<string, number> }> }>(
      'reporting.facts.orders-daily',
      'v1_d2022-08-12'
    );
    expect(partition).not.toBeNull();
    const currencies = partition!.value.rows.map((r) => r.k.currency).sort();
    // Two currencies must remain two rows — never summed together.
    expect(currencies).toEqual(['EUR', 'GBP']);
  });

  it('is idempotent: running twice produces byte-identical partitions', async () => {
    const port = new FakePort();
    const orders = [order('o1'), order('o2', { totalPrice: { currencyCode: 'EUR', centAmount: 4000, fractionDigits: 2 } })];

    await runJob({ port, scanner: fakeScanner(orders), now: () => new Date('2026-08-21T00:00:00Z') });
    const first = JSON.stringify(
      (await port.get('reporting.facts.orders-daily', 'v1_d2022-08-12'))?.value
    );

    // Reset the cursor so the second run re-scans the same orders, as a backfill re-run would.
    await port.delete('reporting.cursors', 'reporting-rollup-job');
    await runJob({ port, scanner: fakeScanner(orders), now: () => new Date('2026-08-21T00:05:00Z') });
    const second = JSON.parse(
      JSON.stringify((await port.get('reporting.facts.orders-daily', 'v1_d2022-08-12'))?.value)
    );

    // The rows must be identical; only volatile meta (builtAt) may differ.
    const firstRows = JSON.parse(first).rows;
    expect(second.rows).toEqual(firstRows);
  });

  it('re-derives a fact wholesale, so a duplicate order delivery does not double-count', async () => {
    const port = new FakePort();
    // The same order id twice with the same version: the second write is a no-op.
    const orders = [order('dup'), order('dup')];
    const result = await runJob({
      port,
      scanner: fakeScanner(orders),
      now: () => new Date('2026-08-21T00:00:00Z'),
    });
    // Both "processed", but only one fact object exists and revenue is counted once.
    expect(result.ordersProcessed).toBe(2);
    const partition = await port.get<{ rows: Array<{ m: Record<string, number> }> }>(
      'reporting.facts.orders-daily',
      'v1_d2022-08-12'
    );
    const orderCount = partition!.value.rows.reduce((sum, r) => sum + (r.m.orders ?? 0), 0);
    expect(orderCount).toBe(1);
  });

  it('lets a newer order version overwrite an older one', async () => {
    const port = new FakePort();
    await runJob({
      port,
      scanner: fakeScanner([
        order('o1', {
          version: 1,
          taxedPrice: null,
          totalPrice: { currencyCode: 'EUR', centAmount: 10000, fractionDigits: 2 },
        }),
      ]),
      now: () => new Date('2026-08-21T00:00:00Z'),
    });
    await port.delete('reporting.cursors', 'reporting-rollup-job');
    // Same order, higher version, larger amount — must win. taxedPrice dropped so net falls
    // back to totalPrice and the assertion targets the value under test.
    await runJob({
      port,
      scanner: fakeScanner([
        order('o1', {
          version: 2,
          taxedPrice: null,
          totalPrice: { currencyCode: 'EUR', centAmount: 25000, fractionDigits: 2 },
        }),
      ]),
      now: () => new Date('2026-08-21T00:05:00Z'),
    });
    const fact = await port.get<OrderFact>('reporting.order-facts-2022-08', 'o1');
    expect(fact!.value.orderVersion).toBe(2);
    expect(fact!.value.measures.revenueNet).toBe(25000);
  });

  it('declines to run when another run holds the lock', async () => {
    const port = new FakePort();
    // Pre-seed a live lock owned by someone else.
    await port.put('reporting.locks', 'reporting-rollup-job', {
      owner: 'reporting-rollup-job',
      runId: 'someone-else',
      acquiredAt: '2026-08-21T00:00:00.000Z',
      heartbeatAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:40:00.000Z',
    });
    const result = await runJob({
      port,
      scanner: fakeScanner([order('o1')]),
      now: () => new Date('2026-08-21T00:10:00Z'),
    });
    expect(result.skipped).toBe(true);
    expect(result.ordersProcessed).toBe(0);
  });

  it('walks past a single page — proving keyset pagination, not offset', async () => {
    const port = new FakePort();
    // 5 orders on distinct days, page size 2 → at least 3 pages.
    const orders = Array.from({ length: 5 }, (_, i) =>
      order(`o${i}`, {
        lastModifiedAt: `2026-08-0${i + 1}T10:00:00.000Z`,
        createdAt: `2022-08-1${i}T10:00:00.000Z`,
      })
    );
    const scanner = fakeScanner(orders);
    const result = await runJob({ port, scanner, now: () => new Date('2026-08-21T00:00:00Z') });
    expect(result.ordersProcessed).toBe(5);
    expect(scanner.calls).toBeGreaterThanOrEqual(3);
  });

  it('writes a watermark once the scan completes', async () => {
    const port = new FakePort();
    await runJob({ port, scanner: fakeScanner([order('o1')]), now: () => new Date('2026-08-21T09:00:00Z') });
    const watermark = await port.get<{ throughDate: string }>(
      'reporting.config',
      'rollup-watermark'
    );
    expect(watermark).not.toBeNull();
    // Through the scan's safe upper bound (now - 120s), i.e. today.
    expect(watermark!.value.throughDate).toBe('2026-08-21');
  });
});
