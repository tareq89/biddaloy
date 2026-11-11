import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

const ctx = (user: unknown, headers: Record<string, string> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as unknown as ExecutionContext;

const home = { id: vi.fn().mockResolvedValue('home-1') } as any;
const guard = () => new PlatformAdminGuard(home);
const refusal = async (user: unknown) => {
  try {
    await guard().canActivate(ctx(user));
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse();
  }
  throw new Error('guard let the request through');
};

describe('PlatformAdminGuard', () => {
  it('passes a cockpit principal, ignoring any tenant header, and sets the platform scope id', async () => {
    const user = { sub: 'u1', jti: 'j', fam: 'f', typ: 'cockpit' };
    const request: any = { user, headers: { 'x-tenant-id': 'nope' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(await guard().canActivate(context)).toBe(true);
    expect(request.platformScopeTenantId).toBe('home-1');
  });

  it('refuses an app-token principal, no principal and a wrong typ with the same body', async () => {
    const appToken = await refusal({ sub: 'u1', memberships: [{ role: 'SUPER_ADMIN' }] });
    expect(await refusal(undefined)).toEqual(appToken);
    expect(await refusal({ typ: 'access' })).toEqual(appToken);
    expect(await refusal({ typ: 'COCKPIT' })).toEqual(appToken);
    expect(await refusal({ sub: 'u1', jti: 'j', fam: 'f', typ: 'Cockpit' })).toEqual(appToken);
    expect(await refusal({ sub: 'u1', jti: 'j', fam: 'f' })).toEqual(appToken);
    expect(await refusal({ sub: '', jti: 'j', fam: 'f', typ: 'cockpit' })).toEqual(appToken);
    expect(await refusal({ sub: 'u1', jti: 5, fam: 'f', typ: 'cockpit' })).toEqual(appToken);
    expect(await refusal({ sub: 'u1', jti: 'j', fam: '', typ: 'cockpit' })).toEqual(appToken);
  });
});
