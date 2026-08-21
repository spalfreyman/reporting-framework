import { CO } from '../shared/schema/descriptor.js';
import type { CustomObjectPort } from '../shared/ct/ports.js';
import type { AccessPolicy, ScopeAssignment } from '../shared/framing/access.js';

/**
 * Access policies and per-subject scope assignments, stored as Custom Objects so an
 * administrator can change who sees what without a redeploy.
 */

export const loadPolicies = async (port: CustomObjectPort): Promise<AccessPolicy[]> => {
  const page = await port.query<AccessPolicy>(CO.accessPolicy, { limit: 100 });
  return page.results
    .map((entry) => entry.value)
    .filter((policy): policy is AccessPolicy => Boolean(policy?.key))
    .sort((a, b) => a.priority - b.priority);
};

export const loadScopeAssignment = async (
  port: CustomObjectPort,
  subjectId: string
): Promise<ScopeAssignment | null> => {
  const entry = await port.get<ScopeAssignment>(CO.subjectScope, subjectId);
  return entry?.value ?? null;
};
