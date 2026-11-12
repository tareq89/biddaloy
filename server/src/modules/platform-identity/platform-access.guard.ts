import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isCockpitPrincipal } from './cockpit-principal';

/**
 * [Epic 98] Platform-only routes: passes a cockpit token and nothing else. A school token (any
 * role, SUPER_ADMIN included) is refused, so no membership can reach a platform route. Reads
 * `request.user` only (no `X-Tenant-ID`, so no `ContextGuard`). Run after
 * `AuthGuard(['jwt', 'cockpit-jwt'])`. Every refusal is the same sentence (Rule 23).
 */
@Injectable()
export class PlatformAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (isCockpitPrincipal(context.switchToHttp().getRequest<{ user?: unknown }>().user)) {
      return true;
    }
    throw new ForbiddenException('This area is for platform owners only');
  }
}
