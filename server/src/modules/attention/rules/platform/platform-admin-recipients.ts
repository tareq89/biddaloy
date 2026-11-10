import type { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';

/**
 * [Epic 98] Active, unlocked platform owners as alert recipients. Reads `platform_admins`, not
 * `user_tenants`: an owner has no membership on the platform home school. The older platform
 * rules keep `platformRecipients` (platform-tenant.ts) until Wave 5.
 */
export async function platformAdminRecipients(
  dataSource: DataSource,
): Promise<{ userId: string; role: UserRole }[]> {
  const rows: { userId: string }[] = await dataSource.query(
    `SELECT pa.user_id AS "userId"
       FROM platform_admins pa
       JOIN users u ON u.id = pa.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      WHERE pa.locked_at IS NULL
      ORDER BY pa.user_id`,
  );
  return rows.map((r) => ({ userId: r.userId, role: UserRole.SUPER_ADMIN }));
}
