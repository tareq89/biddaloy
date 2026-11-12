import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  JwtPayload,
  JwtMembership,
  UserRole,
  SchoolStatus,
  ImpersonatedJwtPayload,
} from '@biddaloy/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY } from '../decorators/allow-when-suspended-for-billing.decorator';
import { ALLOW_WHEN_READ_ONLY_KEY } from '../decorators/allow-when-read-only.decorator';
import {
  BILLING_SUSPENSION_REASONS,
  TenantStatusService,
  tenantRestoringException,
} from '../../schools/tenant-status.service';

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
  EXAM_CONTROLLER: 68,
  OFFICE_STAFF: 66,
  COMMITTEE: 64,
  PARENT: 60,
  STUDENT: 50,
};

/**
 * Computes the current active role. If the user has a single membership
 * in the tenant, that role is used. If multiple, the highest-priority role
 * wins unless the client explicitly sends X-Role.
 */
export function resolveRole(
  memberships: JwtMembership[],
  tenantId: string,
  explicitRole: string | undefined,
): string | null {
  const tenantMemberships = memberships.filter((m: JwtMembership) => m.tenantId === tenantId);

  if (tenantMemberships.length === 0) {
    // [Epic 98] No membership in this tenant is always a refusal: platform authority lives in
    // `platform_admins` and a cockpit token, never in a SUPER_ADMIN membership.
    return null;
  }

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
 * [Epic 98] A tenant ID that is not in the user's memberships is always refused: there is no
 * cross-tenant authority here (platform owners use a cockpit token, `PlatformAccessGuard`).
 *
 * Throws 401 if:
 * - X-Tenant-ID is missing
 * - The tenant ID is not in the user's memberships
 * - The explicit X-Role is not found in the tenant's memberships
 *
 * Throws 403 if the resolved tenant is SUSPENDED.
 */
@Injectable()
export class ContextGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const tenantId = request.headers['x-tenant-id'];
    if (!tenantId) {
      throw new UnauthorizedException('X-Tenant-ID header is required');
    }

    // Login as (Epic 99): the session pins school and role. The whole block runs before any DB read.
    const imp = (user as Partial<ImpersonatedJwtPayload>).impSession;
    let activeRole: string | null;
    if (imp) {
      const headerRole = request.headers['x-role'] as string | undefined;
      const pinned =
        tenantId === imp.schoolId &&
        (!headerRole || String(headerRole).toUpperCase() === String(imp.role).toUpperCase()) &&
        imp.role !== UserRole.SUPER_ADMIN &&
        user.memberships.some(
          (m: JwtMembership) => m.tenantId === imp.schoolId && m.role === imp.role,
        );
      if (!pinned) {
        throw new UnauthorizedException('User is not a member of the requested tenant');
      }
      const method = String(request.method ?? '').toUpperCase();
      if ((imp.viewOnly || imp.writeLocked) && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        throw new ForbiddenException({
          message: 'This sign-in is view only',
          details: { code: 'SUPPORT_VIEW_ONLY' },
        });
      }
      activeRole = imp.role;
    } else {
      const explicitRole = request.headers['x-role'] as string | undefined;
      activeRole = resolveRole(user.memberships, tenantId, explicitRole);
    }

    if (!activeRole) {
      throw new UnauthorizedException('User is not a member of the requested tenant');
    }

    // Resolve the tenant explicitly so a nonexistent/malformed id gives a clean 401 instead of
    // reaching a downstream `findOneOrFail` and 500ing, and a SUSPENDED school stays blocked.
    const status = await this.tenantStatus.getStatus(tenantId);
    if (status === null) {
      throw new UnauthorizedException('The requested tenant does not exist');
    }
    // D6: a suspended school does not block a support session.
    if (!imp && status !== SchoolStatus.ACTIVE) {
      const reason = await this.tenantStatus.getStatusReason(tenantId);
      // D16: an ended trial may still export. Only a route marked
      // @AllowWhenSuspendedForBilling, only SUSPENDED + TRIAL_EXPIRED; PermissionsGuard
      // still checks the permission. The final yes comes from an uncached DB read
      // (`isSuspendedForBilling`), so a stale cached reason cannot keep export open (#2399).
      const trialExportAllowed =
        status === SchoolStatus.SUSPENDED &&
        BILLING_SUSPENSION_REASONS.includes(reason ?? '') &&
        this.reflector.get<boolean>(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, context.getHandler()) ===
          true &&
        (await this.tenantStatus.isSuspendedForBilling(tenantId));
      if (!trialExportAllowed) {
        throw new ForbiddenException({
          message: 'This school has been suspended',
          details: {
            code: 'TENANT_SUSPENDED',
            ...(reason && BILLING_SUSPENSION_REASONS.includes(reason) ? { reason } : {}),
          },
        });
      }
    }

    // Seat grace (Epic 49 D9): an ACTIVE school over its seats can read but not write until the
    // daily job suspends it. Handlers marked @AllowWhenSuspendedForBilling
    // stay open; the billing routes must carry that mark (billing lane) for a school to pay.
    // One message for every write (Rule 23); `until` is the school's own date, not an echo of input.
    if (!imp && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // @AllowWhenReadOnly: a user's own writes (alerts seen, step-up, push, preferences).
      const allowed =
        this.reflector.get<boolean>(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, context.getHandler()) ===
          true ||
        this.reflector.get<boolean>(ALLOW_WHEN_READ_ONLY_KEY, context.getHandler()) === true;
      if (!allowed) {
        const until = await this.tenantStatus.getReadOnlyUntil(tenantId);
        if (until) {
          throw new ForbiddenException({
            message: 'This school is read-only',
            details: { code: 'TENANT_READ_ONLY', until: until.toISOString() },
          });
        }
      }
    }

    // A restore is replacing this school's data: refuse writes (not reads) so nothing saved
    // mid-restore is wiped by it or missed by its snapshot (#2210).
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (await this.tenantStatus.isRestoring(tenantId))
    ) {
      throw tenantRestoringException();
    }

    // Attach active context to request for downstream use
    request.currentTenant = {
      id: tenantId,
      role: activeRole,
    };

    request.currentUser = user;
    if (imp) request.impersonation = imp;

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
      throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
