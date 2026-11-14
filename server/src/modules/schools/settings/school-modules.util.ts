import { resolveModuleState, type ModuleKey } from '@biddaloy/shared';
import type { ModuleStateReader } from '../../auth/guards/module-state.reader';

/**
 * [77.2.10] D9: is `key` on for the whole school? Background jobs ask this per tenant and skip an
 * off school. No role is passed, so a role-off module never stops a school job (D38).
 * A read failure throws: callers skip that school and log (never treat unknown as on).
 */
export async function isModuleOnForSchool(
  reader: ModuleStateReader,
  tenantId: string,
  key: ModuleKey,
): Promise<boolean> {
  const { platform, school } = await reader.forTenant(tenantId);
  return resolveModuleState({ platform, school, role: undefined }, key).on;
}
