import { readConfiguration } from './env.js';
import { decodeDelivery } from './decode.js';
import { fetchOrder } from './client.js';
import { orderFactContainerFor } from './shared/rollup/keying.js';
import { toOrderFact } from './shared/rollup/order-mapping.js';
import { ConcurrentModificationError, type CustomObjectPort } from './shared/ct/ports.js';
import type { OrderFact } from './shared/rollup/keying.js';
import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import type { Logger } from './logger.js';

/**
 * Processes one Subscription delivery.
 *
 * Returns an HTTP status. The rule that governs it: return a positive ack (2xx) whenever the
 * message needs no redelivery — handled, irrelevant, or a deleted order. Reserve non-ack for
 * a transient failure that a retry could genuinely fix. A marker service gains nothing from a
 * redelivery storm, and the nightly reconcile is the safety net.
 */
export const processDelivery = async (
  body: unknown,
  deps: { port: CustomObjectPort; apiRoot: ByProjectKeyRequestBuilder; log: Logger }
): Promise<{ status: number; outcome: string }> => {
  const config = readConfiguration();
  const decoded = decodeDelivery(body);

  if (decoded.kind === 'invalid') {
    // Malformed and unretryable: ack so it is not redelivered forever, but log loudly.
    deps.log.warn('acking an undecodable delivery', { reason: decoded.reason });
    return { status: 204, outcome: `invalid: ${decoded.reason}` };
  }
  if (decoded.kind === 'ignored') {
    return { status: 204, outcome: `ignored: ${decoded.reason}` };
  }

  // Re-fetch by id — the message is a hint, not the source of truth.
  const order = await fetchOrder(deps.apiRoot, decoded.orderId);
  if (!order) {
    deps.log.info('order no longer exists; acking', { orderId: decoded.orderId });
    return { status: 204, outcome: 'order-deleted' };
  }

  const fact = toOrderFact(order, config.ROLLUP_TIMEZONE);
  const container = orderFactContainerFor(fact.businessDate);
  const existing = await deps.port.get<OrderFact>(container, fact.orderId);

  // Monotonic guard: an out-of-order redelivery of an older version is a no-op.
  if (existing && existing.value.orderVersion >= fact.orderVersion) {
    return { status: 204, outcome: 'stale-version-ignored' };
  }

  try {
    await deps.port.put(container, fact.orderId, fact, existing?.version);
  } catch (error) {
    // Lost a race to a concurrent writer that also had the order — safe to drop.
    if (!(error instanceof ConcurrentModificationError)) throw error;
    return { status: 204, outcome: 'concurrent-write-ignored' };
  }

  deps.log.debug('order fact written', {
    orderId: fact.orderId,
    version: fact.orderVersion,
    businessDate: fact.businessDate,
    type: decoded.type,
  });
  // The day is refolded by the job on its cadence, not here: folding a shared day partition
  // from every event would put all of "today"'s orders in contention on one object.
  return { status: 204, outcome: 'fact-written' };
};
