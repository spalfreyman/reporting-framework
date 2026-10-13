import { CO } from '../schema/descriptor.js';
import {
  dataSourceDescriptorSchema,
  type DataSourceDescriptor,
} from '../schema/descriptor.js';
import type { CustomObjectPort } from '../ct/ports.js';
import { stableHash } from '../util/hash.js';

/**
 * Self-registration: how a connector announces itself to the framework.
 *
 * The descriptor is written to Custom Object `reporting.datasources/<sourceId>` in
 * postDeploy. The gateway lists that container to build its registry — so installing a
 * connector extends the framework with NO framework redeploy, and uninstalling one degrades
 * the affected reports rather than breaking them.
 *
 * Idempotent by construction: Connect re-runs postDeploy on every redeploy, so this is
 * get-then-compare-then-update, never delete-then-recreate. An unchanged descriptor is a
 * no-op, which also keeps the gateway's 60-second change detection quiet.
 */

export interface RegistrationOutcome {
  action: 'created' | 'updated' | 'unchanged';
  sourceId: string;
}

export const registerDescriptor = async (
  port: CustomObjectPort,
  descriptor: DataSourceDescriptor
): Promise<RegistrationOutcome> => {
  // Validate before publishing: a malformed descriptor would be silently ignored by the
  // gateway, which presents as "I installed the connector and nothing happened".
  const parsed = dataSourceDescriptorSchema.safeParse(descriptor);
  if (!parsed.success) {
    throw new Error(
      `Refusing to publish an invalid descriptor for "${descriptor.sourceId}": ` +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    );
  }

  const existing = await port.get<DataSourceDescriptor>(CO.datasources, descriptor.sourceId);

  if (existing) {
    // Compare ignoring registeredAt, or every redeploy would look like a change.
    const strip = (d: DataSourceDescriptor) => ({ ...d, registeredAt: '' });
    if (stableHash(strip(existing.value)) === stableHash(strip(parsed.data))) {
      return { action: 'unchanged', sourceId: descriptor.sourceId };
    }
  }

  await port.put(CO.datasources, descriptor.sourceId, parsed.data, existing?.version);
  return { action: existing ? 'updated' : 'created', sourceId: descriptor.sourceId };
};

/** preUndeploy: withdraw only our own descriptor, never another connector's. */
export const unregisterDescriptor = async (
  port: CustomObjectPort,
  sourceId: string
): Promise<void> => {
  await port.delete(CO.datasources, sourceId);
};
