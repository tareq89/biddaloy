import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { TenantStatusService } from '../../../schools/tenant-status.service';

/** Active SUPER_ADMIN members of the platform tenant (`isPlatformSuperAdmin`). */
export async function platformRecipients(
  dataSource: DataSource,
  platformTenantId: string,
): Promise<{ userId: string; role: UserRole }[]> {
  const rows: { userId: string }[] = await dataSource.query(
    `SELECT ut.user_id AS "userId" FROM user_tenants ut
     JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
     WHERE ut.tenant_id = $1 AND ut.role = 'SUPER_ADMIN' AND ut.deleted_at IS NULL`,
    [platformTenantId],
  );
  return rows.map((r) => ({ userId: r.userId, role: UserRole.SUPER_ADMIN }));
}

/** `school1, school2, school3 …` — at most three names (never any other school data). */
export const schoolNames = (names: string[]): string =>
  names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '');

/**
 * Which school is "the platform tenant" — platform alerts live there and
 * nowhere else. Delegates to `TenantStatusService.platformTenantId()`, the one
 * resolver ContextGuard also uses, so the two can never drift.
 */
@Injectable()
export class PlatformTenantResolver {
  constructor(private readonly tenantStatus: TenantStatusService) {}

  resolve(): Promise<string | undefined> {
    return this.tenantStatus.platformTenantId();
  }
}
