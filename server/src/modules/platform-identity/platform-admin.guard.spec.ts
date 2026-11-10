import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

const ctx = (user: unknown, headers: Record<string, string> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as unknown as ExecutionContext;

const refusal = (user: unknown) => {
  try {
    new PlatformAdminGuard().canActivate(ctx(user));
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse();
  }
  throw new Error('guard let the request through');
};

describe('PlatformAdminGuard', () => {
  it('passes a cockpit principal, ignoring any tenant header', () => {
    const user = { sub: 'u1', jti: 'j', fam: 'f', typ: 'cockpit' };
    expect(new PlatformAdminGuard().canActivate(ctx(user, { 'x-tenant-id': 'nope' }))).toBe(true);
  });

  it('refuses an app-token principal, no principal and a wrong typ with the same body', () => {
    const appToken = refusal({ sub: 'u1', memberships: [{ role: 'SUPER_ADMIN' }] });
    expect(refusal(undefined)).toEqual(appToken);
    expect(refusal({ typ: 'access' })).toEqual(appToken);
    expect(refusal({ typ: 'COCKPIT' })).toEqual(appToken);
    expect(refusal({ sub: 'u1', jti: 'j', fam: 'f', typ: 'Cockpit' })).toEqual(appToken);
    expect(refusal({ sub: 'u1', jti: 'j', fam: 'f' })).toEqual(appToken);
    expect(refusal({ sub: '', jti: 'j', fam: 'f', typ: 'cockpit' })).toEqual(appToken);
    expect(refusal({ sub: 'u1', jti: 5, fam: 'f', typ: 'cockpit' })).toEqual(appToken);
    expect(refusal({ sub: 'u1', jti: 'j', fam: '', typ: 'cockpit' })).toEqual(appToken);
  });
});
