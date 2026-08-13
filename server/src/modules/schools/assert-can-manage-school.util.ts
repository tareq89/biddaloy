import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';

/**
 * A super admin configures *any* school; an admin configures only their
 * own. Both roles hold `SETTINGS_MANAGE` (see `shared/enums/permissions`),
 * so the permission alone doesn't express the difference — this is that
 * check, enforced server-side rather than by hiding a nav item.
 *
 * Deliberately a 403, not the codebase's usual cross-tenant 404
 * (`cross-tenant-access.e2e-spec.ts`'s convention for a resource scoped
 * *by* tenant, like a student or invoice): `schoolId` here doesn't belong
 * to a tenant, it *is* one, so "wrong tenant" is an authorization decision
 * about the caller, not a lookup that came up empty. Checked before any
 * DB read, so a rejected request never depends on whether `schoolId`
 * happens to be a real school.
 *
 * Shared between `SchoolsController` (#8.7.9) and
 * `ProviderConnectionTestController` (#8.7.12) — same permission and
 * tenant-scope rules apply to both, per #8.7.12's own acceptance criteria.
 */
export function assertCanManageSchool(
  tenant: { id: string; role: string },
  schoolId: string,
): void {
  if (tenant.role === UserRole.SUPER_ADMIN) return;
  if (tenant.id === schoolId) return;
  throw new ForbiddenException(`Not permitted to manage settings for school "${schoolId}".`);
}
