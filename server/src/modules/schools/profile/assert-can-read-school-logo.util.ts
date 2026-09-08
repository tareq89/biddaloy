import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';

/**
 * [15.5.4] `GET /schools/:id/logo` is readable by any staff role that's a
 * member of that exact school, or a SUPER_ADMIN reading any school —
 * unlike `assertCanManageSchool` (settings), this isn't ADMIN-restricted:
 * a TEACHER or ACCOUNTANT rendering a print view still needs to load the
 * logo `<img>`. `tenant.id` here is the caller's *active* tenant context
 * (already proven a real membership by `ContextGuard`), so "member of
 * :id" reduces to "the active tenant IS :id".
 */
export function assertCanReadSchoolLogo(
  tenant: { id: string; role: string },
  schoolId: string,
): void {
  if (tenant.role === UserRole.SUPER_ADMIN) return;
  if (tenant.id === schoolId) return;
  throw new ForbiddenException(`Not permitted to read the logo for school "${schoolId}".`);
}
