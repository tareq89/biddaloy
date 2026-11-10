import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '@biddaloy/shared';
import { isPlatformSuperAdmin } from '../auth/guards/context.guard';
import { TenantStatusService } from '../schools/tenant-status.service';
import { isCockpitPrincipal } from './cockpit-principal';

/**
 * [Epic 98] Staged cutover (D4/D23) for platform-only routes: passes a cockpit token OR a legacy
 * platform-tenant SUPER_ADMIN app token. Reads `request.user` only (no `X-Tenant-ID`, so no
 * `ContextGuard`). Run after `AuthGuard(['jwt', 'cockpit-jwt'])`. Wave 5 drops the legacy branch.
 * Every refusal is the same sentence (Rule 23).
 */
@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(private readonly tenantStatus: TenantStatusService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: unknown }>().user;
    if (isCockpitPrincipal(user)) return true;
    const memberships = (user as JwtPayload | undefined)?.memberships;
    if (
      Array.isArray(memberships) &&
      isPlatformSuperAdmin(memberships, await this.tenantStatus.platformTenantId())
    ) {
      return true;
    }
    throw new ForbiddenException('This area is for platform owners only');
  }
}
