import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * For routes that act on a school named in the path, not the caller's own:
 * requires genuine platform SUPER_ADMIN authority (`request.isPlatformSuperAdmin`,
 * set by `ContextGuard`). `@Roles(SUPER_ADMIN)` alone is not enough — a legacy
 * tenant-local SUPER_ADMIN (see `isPlatformSuperAdmin`) passes it. Run after
 * `ContextGuard`.
 */
@Injectable()
export class PlatformSuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!context.switchToHttp().getRequest().isPlatformSuperAdmin) {
      throw new ForbiddenException('Requires platform SUPER_ADMIN authority');
    }
    return true;
  }
}
