import { beforeEach, describe, expect, it } from 'vitest';
import { decodeDelivery } from '../src/decode.js';
import { processDelivery } from '../src/handler.js';
import { resetConfiguration } from '../src/env.js';
import type { CustomObject, CustomObjectPage, CustomObjectPort } from '../src/shared/ct/ports.js';
import type { OrderFact } from '../src/shared/rollup/keying.js';
import { createLogger } from '../src/logger.js';

const ENV = {
  CTP_PROJECT_KEY: 'sp-demo',
  CTP_REGION: 'europe-west1.gcp',
  CTP_CLIENT_ID: 'id',
  CTP_CLIENT_SECRET: 'secret',
  CTP_SCOPE: 'manage_project:sp-demo',
  ROLLUP_TIMEZONE: 'UTC',
  LOG_LEVEL: 'error',
};

beforeEach(() => {
  resetConfiguration();
  Object.assign(process.env, ENV);
});

const pubsub = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
});

const orderCreated = (id: string) => ({
  notificationType: 'Message',
  type: 'OrderCreated',
  resource: { typeId: 'order', id },
});

describe('envelope decoding', () => {
  it('unwraps a Pub/Sub envelope and extracts the order id', () => {
    const decoded = decodeDelivery(pubsub(orderCreated('order-123')));
    expect(decoded).toEqual({ kind: 'order', orderId: 'order-123', type: 'OrderCreated' });
  });

  it('accepts a bare (unwrapped) notification too', () => {
    expect(decodeDelivery(orderCreated('order-9'))).toMatchObject({ kind: 'order', orderId: 'order-9' });
  });

  it('ignores the platform test/probe message rather than choking on it', () => {
    const decoded = decodeDelivery({ notificationType: 'Test' });
    expect(decoded.kind).toBe('ignored');
  });

  it('ignores a non-order resource', () => {
    const decoded = decodeDelivery(pubsub({ notificationType: 'Message', resource: { typeId: 'product', id: 'p1' } }));
    expect(decoded.kind).toBe('ignored');
  });

  it('ignores an order message type it does not track', () => {
    const decoded = decodeDelivery(pubsub({ ...orderCreated('o1'), type: 'OrderBillingAddressSet' }));
    expect(decoded.kind).toBe('ignored');
  });

  it('flags base64 that is not JSON as invalid, without throwing', () => {
    const decoded = decodeDelivery({ message: { data: 'not-base64-json!!!' } });
    expect(decoded.kind).toBe('invalid');
  });
});

// ── Handler ──────────────────────────────────────────────────────────────────────

class FakePort implements CustomObjectPort {
  store = new Map<string, CustomObject>();
  async get<T>(container: string, key: string) {
    return (this.store.get(`${container}::${key}`) as CustomObject<T>) ?? null;
  }
  async put<T>(container: string, key: string, value: T, version?: number) {
    const existing = this.store.get(`${container}::${key}`);
    if (existing && version !== undefined && existing.version !== version) {
      throw Object.assign(new Error('conflict'), { name: 'ConcurrentModificationError' });
    }
    const next: CustomObject = { id: key, version: (existing?.version ?? 0) + 1, container, key, value };
    this.store.set(`${container}::${key}`, next);
    return next as CustomObject<T>;
  }
  async delete(container: string, key: string) {
    this.store.delete(`${container}::${key}`);
  }
  async query<T>() {
    return { results: [], offset: 0, count: 0, total: 0 } satisfies CustomObjectPage<T>;
  }
}

const fakeOrder = (id: string, version: number, net: number) => ({
  id,
  version,
  createdAt: '2022-08-12T10:00:00.000Z',
  lastModifiedAt: '2022-08-12T10:00:00.000Z',
  orderState: 'Complete',
  country: 'DE',
  totalPrice: { currencyCode: 'EUR', centAmount: net, fractionDigits: 2 },
  taxedPrice: null,
  lineItems: [],
});

const apiRootReturning = (order: unknown) =>
  ({
    orders: () => ({
      withId: () => ({ get: () => ({ execute: async () => ({ body: order }) }) }),
    }),
  }) as never;

const log = createLogger('error');

describe('delivery handler', () => {
  it('writes an order fact and acks', async () => {
    const port = new FakePort();
    const result = await processDelivery(pubsub(orderCreated('o1')), {
      port,
      apiRoot: apiRootReturning(fakeOrder('o1', 1, 10000)),
      log,
    });
    expect(result.status).toBe(204);
    expect(result.outcome).toBe('fact-written');
    const fact = await port.get<OrderFact>('reporting.order-facts-2022-08', 'o1');
    expect(fact!.value.measures.revenueNet).toBe(10000);
  });

  it('re-fetches the order rather than trusting the message payload', async () => {
    // The message says nothing about money; the fact must reflect the FETCHED order.
    const port = new FakePort();
    await processDelivery(pubsub(orderCreated('o2')), {
      port,
      apiRoot: apiRootReturning(fakeOrder('o2', 1, 7777)),
      log,
    });
    const fact = await port.get<OrderFact>('reporting.order-facts-2022-08', 'o2');
    expect(fact!.value.measures.revenueNet).toBe(7777);
  });

  it('ignores a stale (older-version) redelivery — no double count', async () => {
    const port = new FakePort();
    await processDelivery(pubsub(orderCreated('o3')), {
      port,
      apiRoot: apiRootReturning(fakeOrder('o3', 5, 5000)),
      log,
    });
    // A redelivery that fetches an OLDER version must not overwrite.
    const result = await processDelivery(pubsub(orderCreated('o3')), {
      port,
      apiRoot: apiRootReturning(fakeOrder('o3', 3, 999)),
      log,
    });
    expect(result.outcome).toBe('stale-version-ignored');
    const fact = await port.get<OrderFact>('reporting.order-facts-2022-08', 'o3');
    expect(fact!.value.orderVersion).toBe(5);
    expect(fact!.value.measures.revenueNet).toBe(5000);
  });

  it('acks a deleted order instead of failing forever', async () => {
    const port = new FakePort();
    const notFound = {
      orders: () => ({
        withId: () => ({
          get: () => ({
            execute: async () => {
              throw Object.assign(new Error('not found'), { statusCode: 404 });
            },
          }),
        }),
      }),
    } as never;
    const result = await processDelivery(pubsub(orderCreated('gone')), { port, apiRoot: notFound, log });
    expect(result.status).toBe(204);
    expect(result.outcome).toBe('order-deleted');
  });

  it('acks (does not retry) an undecodable delivery', async () => {
    const port = new FakePort();
    const result = await processDelivery(
      { message: { data: 'garbage!!!' } },
      { port, apiRoot: apiRootReturning(null), log }
    );
    expect(result.status).toBe(204);
    expect(result.outcome).toMatch(/invalid/);
  });

  it('acks an irrelevant message type without touching the store', async () => {
    const port = new FakePort();
    const result = await processDelivery(pubsub({ notificationType: 'Message', resource: { typeId: 'customer', id: 'c1' } }), {
      port,
      apiRoot: apiRootReturning(null),
      log,
    });
    expect(result.status).toBe(204);
    expect(result.outcome).toMatch(/ignored/);
    expect(port.store.size).toBe(0);
  });
});
