import { z } from 'zod';

/**
 * Decodes and validates a commercetools Subscription delivery.
 *
 * Messages arrive wrapped in the destination's envelope — for Google Cloud Pub/Sub that is
 * `{ message: { data: <base64> } }`. The inner payload is the commercetools notification.
 *
 * The whole point of validating here is that a malformed or irrelevant delivery is
 * ACKNOWLEDGED and dropped, never retried: a redelivery storm on a marker service buys
 * nothing, and the nightly reconcile catches anything genuinely missed.
 */

const notificationSchema = z.object({
  notificationType: z.string().optional(),
  resource: z.object({ typeId: z.string(), id: z.string() }).optional(),
  type: z.string().optional(),
  resourceUserProvidedIdentifiers: z.record(z.unknown()).optional(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** Order message types worth reacting to. Anything else is acked and ignored. */
export const RELEVANT_ORDER_TYPES = new Set([
  'OrderCreated',
  'OrderImported',
  'OrderStateChanged',
  'OrderStateTransition',
  'OrderPaymentStateChanged',
  'OrderShipmentStateChanged',
  'ReturnInfoAdded',
  'ReturnInfoSet',
  'OrderCustomerSet',
  'OrderStoreSet',
]);

export type DecodeResult =
  | { kind: 'order'; orderId: string; type: string }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; reason: string };

export const decodeDelivery = (body: unknown): DecodeResult => {
  if (typeof body !== 'object' || body === null) {
    return { kind: 'invalid', reason: 'body is not an object' };
  }

  // Unwrap the Pub/Sub envelope if present; otherwise treat the body as the notification.
  let payload: unknown = body;
  const maybeEnvelope = body as { message?: { data?: string } };
  if (maybeEnvelope.message?.data) {
    try {
      payload = JSON.parse(Buffer.from(maybeEnvelope.message.data, 'base64').toString('utf8'));
    } catch {
      return { kind: 'invalid', reason: 'message.data is not base64-encoded JSON' };
    }
  }

  const parsed = notificationSchema.safeParse(payload);
  if (!parsed.success) return { kind: 'invalid', reason: 'payload is not a notification' };

  const { resource, type, notificationType } = parsed.data;

  // The platform's subscription test/created probes carry no order resource.
  if (notificationType && notificationType !== 'Message') {
    return { kind: 'ignored', reason: `notificationType ${notificationType}` };
  }
  if (!resource || resource.typeId !== 'order') {
    return { kind: 'ignored', reason: `not an order (${resource?.typeId ?? 'none'})` };
  }
  if (type && !RELEVANT_ORDER_TYPES.has(type)) {
    return { kind: 'ignored', reason: `order message type ${type} not tracked` };
  }

  return { kind: 'order', orderId: resource.id, type: type ?? 'unknown' };
};
