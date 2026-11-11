import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAccessGuard } from './platform-access.guard';

const guard = new PlatformAccessGuard();
const ctx = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, headers: {} }) }) }) as ExecutionContext;
const member = (tenantId: string, role: string) => ({
  sub: 'u',
  memberships: [{ tenantId, role }],
});

const refusal = (user: unknown) => {
  try {
    guard.canActivate(ctx(user));
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse();
  }
  throw new Error('guard let the request through');
};

describe('PlatformAccessGuard', () => {
  it('passes a cockpit principal', () => {
    expect(guard.canActivate(ctx({ sub: 'u', jti: 'j', fam: 'f', typ: 'cockpit' }))).toBe(true);
  });

  // [SECURITY] Epic 98 wave 5: no school token gets platform authority, whatever its role or school.
  it('refuses a platform-school SUPER_ADMIN, a tenant-local SUPER_ADMIN, an ADMIN, no user, all alike', () => {
    const local = refusal(member('school-1', 'SUPER_ADMIN'));
    expect(refusal(member('platform-home', 'SUPER_ADMIN'))).toEqual(local);
    expect(refusal(member('platform-home', 'ADMIN'))).toEqual(local);
    expect(refusal(undefined)).toEqual(local);
    expect(refusal({ sub: 'u' })).toEqual(local);
    expect(refusal({ sub: 'u', jti: 'j', fam: 'f', typ: 'app' })).toEqual(local);
  });
});
