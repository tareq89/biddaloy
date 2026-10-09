import type { EntityManager } from 'typeorm';
import { FIELD_CATALOG, type DocumentKind } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { resolveIssuer } from '../../schools/profile/issuer-snapshot';

/** Every catalog key of `kind`, all ''. Resolvers overwrite what they know. */
export function blankValues(kind: DocumentKind): Record<string, string> {
  return Object.fromEntries(FIELD_CATALOG[kind].map((f) => [f.key, '']));
}

/** The `school.*` values shared by every kind (`school.logo` = the logo key). */
export async function schoolValues(
  tenantId: string,
  manager: EntityManager,
): Promise<Record<string, string>> {
  const school = await manager.findOne(School, { where: { id: tenantId } });
  if (!school) return {};
  const i = resolveIssuer({ issuer_snapshot: null }, school);
  return {
    'school.name': i.name,
    'school.name_bn': i.name_bn ?? '',
    'school.address': i.address ?? '',
    'school.phone': i.phone ?? '',
    'school.logo': i.logo_key ?? '',
  };
}
