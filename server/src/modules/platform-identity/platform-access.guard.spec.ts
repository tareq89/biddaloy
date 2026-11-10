import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAccessGuard } from './platform-access.guard';
import type { TenantStatusService } from '../schools/tenant-status.service';

const PLATFORM = 'p-tenant';
const guard = (platformTenantId: string | undefined | 'none' = PLATFORM) =>
  new PlatformAccessGuard({
    platformTenantId: async () => (platformTenantId === 'none' ? undefined : platformTenantId),
  } as unknown as TenantStatusService);
const ctx = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, headers: {} }) }) }) as ExecutionContext;
const member = (tenantId: string, role: string) => ({ sub: 'u', memberships: [{ tenantId, role }] });

const refusal = async (g: PlatformAccessGuard, user: unknown) => {
  try {
    await g.canActivate(ctx(user));
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse();
  }
  throw new Error('guard let the request through');
};

describe('PlatformAccessGuard', () => {
  it('passes a cockpit principal', async () => {
    const user = { sub: 'u', jti: 'j', fam: 'f', typ: 'cockpit' };
    expect(await guard().canActivate(ctx(user))).toBe(true);
  });

  it('passes a platform-tenant SUPER_ADMIN app token', async () => {
    expect(await guard().canActivate(ctx(member(PLATFORM, 'SUPER_ADMIN')))).toBe(true);
  });

  it('refuses a tenant-local SUPER_ADMIN, an ADMIN, no user and no platform tenant, all alike', async () => {
    const local = await refusal(guard(), member('school-1', 'SUPER_ADMIN'));
    expect(await refusal(guard(), member(PLATFORM, 'ADMIN'))).toEqual(local);
    expect(await refusal(guard(), undefined)).toEqual(local);
    expect(await refusal(guard(), { sub: 'u' })).toEqual(local);
    expect(await refusal(guard('none'), member(PLATFORM, 'SUPER_ADMIN'))).toEqual(local);
  });
});
