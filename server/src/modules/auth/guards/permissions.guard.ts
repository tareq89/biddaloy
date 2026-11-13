import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleKey, Permission, resolveModuleState, roleHasPermission } from '@biddaloy/shared';
import { moduleOff } from '../../../common/filters/known-errors';
import { REQUIRES_MODULE_KEY } from '../decorators/require-module.decorator';
import { ModuleStateReader } from './module-state.reader';
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
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    private readonly moduleState: ModuleStateReader,
  ) {}

  // Sync unless the route is tagged @RequiresModule (then it awaits the module state).
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (authenticatedOnly) {
        // [Epic 77] A tagged controller's identity-scoped route is still module-gated.
        return this.withModuleCheck(context);
      }
      // D14: fail closed. A route behind PermissionsGuard must say what it needs.
      throw new ForbiddenException('This route declares no permission');
    }

    const { currentTenant } = context.switchToHttp().getRequest();
    if (!currentTenant) throw new UnauthorizedException('No active tenant context');

    const missing = required.filter((p) => !roleHasPermission(currentTenant.role, p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Requires permission(s): ${missing.join(', ')}`);
    }
    return this.withModuleCheck(context);
  }

  private withModuleCheck(context: ExecutionContext): boolean | Promise<boolean> {
    const key = this.moduleKey(context);
    return key ? this.assertModuleOn(context, key).then(() => true) : true;
  }

  private moduleKey(context: ExecutionContext): ModuleKey | undefined {
    return this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRES_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  /** [Epic 77] 403 with one fixed sentence when the tagged module is off. Reader errors propagate (D27). */
  private async assertModuleOn(context: ExecutionContext, key: ModuleKey): Promise<void> {
    const { currentTenant } = context.switchToHttp().getRequest();
    // Public slug/token routes have no tenant context here; their service checks (77.2.05/06).
    if (!currentTenant) return;
    const state = await this.moduleState.forTenant(currentTenant.id);
    if (!resolveModuleState({ ...state, role: currentTenant.role }, key).on) throw moduleOff();
  }
}
