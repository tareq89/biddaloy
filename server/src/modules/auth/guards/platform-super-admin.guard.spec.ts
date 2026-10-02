import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformSuperAdminGuard } from './platform-super-admin.guard';

const ctx = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('PlatformSuperAdminGuard', () => {
  const guard = new PlatformSuperAdminGuard();

  it('allows a platform SUPER_ADMIN', () => {
    expect(guard.canActivate(ctx({ isPlatformSuperAdmin: true }))).toBe(true);
  });

  it('rejects a tenant-local SUPER_ADMIN', () => {
    expect(() => guard.canActivate(ctx({ isPlatformSuperAdmin: false }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when ContextGuard did not run', () => {
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });
});
