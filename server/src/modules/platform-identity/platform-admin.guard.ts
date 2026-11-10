import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isCockpitPrincipal } from './cockpit-principal';

/**
 * [Epic 98] Passes only a cockpit token. It reads `request.user.typ` and nothing else: no
 * memberships, no tenant header. Every refusal is the same sentence (Rule 23).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: unknown }>();
    if (!isCockpitPrincipal(request.user)) {
      throw new ForbiddenException('This area is for platform owners only');
    }
    return true;
  }
}
