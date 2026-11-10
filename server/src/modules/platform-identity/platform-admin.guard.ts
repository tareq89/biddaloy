import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isCockpitPrincipal } from './cockpit-principal';
import { PlatformHomeService } from './platform-home.service';

/**
 * [Epic 98] Passes only a cockpit token. Reads `request.user.typ` and nothing else: no
 * memberships, no tenant header. Every refusal is the same sentence (Rule 23).
 * Also stamps `request.platformScopeTenantId` (the platform home id) so `ApprovalService.consume`
 * can check a platform approval token's `tid` where a school route would use `currentTenant`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly home: PlatformHomeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: unknown; platformScopeTenantId?: string }>();
    if (!isCockpitPrincipal(request.user)) {
      throw new ForbiddenException('This area is for platform owners only');
    }
    request.platformScopeTenantId = await this.home.id();
    return true;
  }
}
