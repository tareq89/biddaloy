import type { DataSource } from 'typeorm';
import type { UserRole } from '@biddaloy/shared';

/**
 * Active members of the tenant holding one of `roles`, once per user
 * (first role in the list wins). Shared by the rules in this lane.
 */
export async function roleRecipients(
  dataSource: DataSource,
  tenantId: string,
  roles: UserRole[],
): Promise<{ userId: string; role: UserRole }[]> {
  return dataSource.query(
    `SELECT DISTINCT ON (ut.user_id) ut.user_id AS "userId", ut.role::text AS role
     FROM user_tenants ut
     JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
     WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])
     ORDER BY ut.user_id, array_position($2::text[], ut.role::text)`,
    [tenantId, roles],
  );
}
