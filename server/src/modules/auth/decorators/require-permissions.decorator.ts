import { SetMetadata } from '@nestjs/common';
import { Permission } from '@biddaloy/shared';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the permission(s) a route needs. ALL listed permissions are
 * required. Enforced by PermissionsGuard, which reads ROLE_PERMISSIONS
 * for the active role that ContextGuard resolved.
 *
 * Runs alongside @Roles(...) — see docs/architecture/02-auth-and-multitenancy.md
 * for why both exist and when @Roles can retire.
 *
 * @example
 * @UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
 * @Roles(UserRole.ADMIN)
 * @RequirePermissions(Permission.AUDIT_LOG_READ)
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
