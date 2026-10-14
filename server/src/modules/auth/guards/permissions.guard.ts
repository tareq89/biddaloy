import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, roleHasPermission } from '@biddaloy/shared';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AUTHENTICATED_ONLY_KEY } from '../decorators/authenticated-only.decorator';

/**
 * Enforces @RequirePermissions(...) against ROLE_PERMISSIONS for the
 * active role (req.currentTenant.role, set by ContextGuard).
 *
 * - Fails closed: no @RequirePermissions and no @AuthenticatedOnly() on handler or
 *   class → 403. A route behind this guard must say what it needs.
 * - @AuthenticatedOnly() (identity-scoped routes) → allow with no permission check.
 * - No currentTenant → 401 (ContextGuard did not run; misconfigured route).
 * - Role lacks any required permission → 403.
 *
 * SUPER_ADMIN needs no special case: ROLE_PERMISSIONS[SUPER_ADMIN] is
 * every Permission value, so the map already grants it everything.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (authenticatedOnly) return true;
      // D14: fail closed. A route behind PermissionsGuard must say what it needs.
      throw new ForbiddenException('This route declares no permission');
    }

    const { currentTenant } = context.switchToHttp().getRequest();
    if (!currentTenant) throw new UnauthorizedException('No active tenant context');

    const missing = required.filter((p) => !roleHasPermission(currentTenant.role, p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Requires permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
