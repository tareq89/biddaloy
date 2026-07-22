import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload, JwtMembership } from '@beton-boi/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Priority ordering for role fallback when a user has multiple roles
 * within the same tenant. The highest-priority role is chosen.
 */
const ROLE_PRIORITY: Record<string, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 90,
  ACCOUNTANT: 80,
  EXECUTIVE: 75,
  TEACHER: 70,
  PARENT: 60,
  STUDENT: 50,
};

/**
 * Computes the current active role. If the user has a single membership
 * in the tenant, that role is used. If multiple, the highest-priority role
 * wins unless the client explicitly sends X-Role.
 */
function resolveRole(
  memberships: JwtMembership[],
  tenantId: string,
  explicitRole?: string,
): string | null {
  const tenantMemberships = memberships.filter((m: JwtMembership) => m.tenantId === tenantId);
  if (tenantMemberships.length === 0) return null;

  // If client explicitly requested a role, validate it exists
  if (explicitRole) {
    const match = tenantMemberships.find((m: JwtMembership) => m.role === explicitRole);
    if (match) return match.role;
    return null; // explicit role not found in this tenant
  }

  // Priority fallback: pick the highest-priority role
  return tenantMemberships.reduce((best: JwtMembership, current: JwtMembership) => {
    const currentPriority = ROLE_PRIORITY[current.role] ?? 0;
    const bestPriority = ROLE_PRIORITY[best.role] ?? 0;
    return currentPriority > bestPriority ? current : best;
  }).role;
}

/**
 * Extracts the `X-Tenant-ID` header and validates it against the user's
 * JWT memberships. Attaches the active context to `req.currentTenant`.
 *
 * If the user has multiple roles in the same tenant, the highest-priority
 * role is selected unless `X-Role` is explicitly provided.
 *
 * Throws 401 if:
 * - X-Tenant-ID is missing
 * - The tenant ID is not in the user's memberships
 * - The explicit X-Role is not found in the tenant's memberships
 */
@Injectable()
export class ContextGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const tenantId = request.headers['x-tenant-id'];
    if (!tenantId) {
      throw new UnauthorizedException('X-Tenant-ID header is required');
    }

    const explicitRole = request.headers['x-role'] as string | undefined;
    const activeRole = resolveRole(user.memberships, tenantId, explicitRole);

    if (!activeRole) {
      throw new UnauthorizedException(
        `User is not a member of tenant ${tenantId}`,
      );
    }

    // Attach active context to request for downstream use
    request.currentTenant = {
      id: tenantId,
      role: activeRole,
    };

    request.currentUser = user;

    return true;
  }
}

/**
 * Restricts endpoint access based on the active role from ContextGuard.
 * Throws 403 if the active role is not in the allowed set.
 *
 * Usage:
 * @UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
 * @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles specified, allow access (role-agnostic endpoint)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const currentTenant = request.currentTenant;

    if (!currentTenant) {
      throw new UnauthorizedException('No active tenant context');
    }

    // SUPER_ADMIN bypasses all role checks
    if (currentTenant.role === 'SUPER_ADMIN') {
      return true;
    }

    const hasRole = requiredRoles.includes(currentTenant.role);
    if (!hasRole) {
      throw new UnauthorizedException(
        `Requires one of roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}