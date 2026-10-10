import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { TenantStatusService } from '../../../schools/tenant-status.service';

const DEFAULT_SCHOOL_SLUG = 'default-school';

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
 * nowhere else. Copy of ContextGuard's resolver; keep in sync (Epic 67).
 * `PLATFORM_TENANT_ID` wins; production with it unset fails closed
 * (`undefined`); otherwise the seeded `default-school`, cached once found.
 */
@Injectable()
export class PlatformTenantResolver {
  private cachedDevId?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async resolve(): Promise<string | undefined> {
    const configured = this.config.get<string>('PLATFORM_TENANT_ID');
    if (configured) return configured;
    if (this.config.get<string>('NODE_ENV') === 'production') return undefined;
    if (this.cachedDevId) return this.cachedDevId;
    const found = await this.tenantStatus.findSchoolIdBySlug(DEFAULT_SCHOOL_SLUG);
    if (found) this.cachedDevId = found;
    return found ?? undefined;
  }
}
