import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException, Patch, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { DenyWhenImpersonatingInterceptor } from './deny-when-impersonating.interceptor';
import { DenyWhenImpersonating } from './decorators/deny-when-impersonating.decorator';
import { UserController } from '../users/users.controller';

class Plain {
  @Post()
  open() {}

  @Post()
  @DenyWhenImpersonating()
  marked() {}

  @Patch()
  @DenyWhenImpersonating({ bodyKeys: ['email', 'phone'] })
  keyed() {}
}

@DenyWhenImpersonating()
class Marked {
  @Post()
  a() {}

  @Post()
  b() {}
}

const IMP = { sub: 'u1', imp: { sid: 's1' } };
const ORDINARY = { sub: 'u1' };

function run(cls: Function, handler: string, user: unknown, body?: unknown) {
  const ctx = {
    getHandler: () => (cls as any).prototype[handler],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user, body }) }),
  } as unknown as ExecutionContext;
  const interceptor = new DenyWhenImpersonatingInterceptor(new Reflector());
  return interceptor.intercept(ctx, { handle: () => of('ok') });
}

const passes = (obs: ReturnType<typeof run>) =>
  new Promise((resolve) => obs.subscribe((v) => resolve(v)));

describe('DenyWhenImpersonatingInterceptor', () => {
  it('marked route + imp token gives 403 with the fixed body', () => {
    try {
      run(Plain, 'marked', IMP);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getStatus()).toBe(403);
      expect((e as ForbiddenException).getResponse()).toEqual({
        message: 'This action is not available while Biddaloy support is signed in',
        details: { code: 'IMPERSONATION_DENIED' },
      });
    }
  });

  it('marked route + ordinary token passes', async () => {
    expect(await passes(run(Plain, 'marked', ORDINARY))).toBe('ok');
  });

  it('unmarked route + imp token passes', async () => {
    expect(await passes(run(Plain, 'open', IMP))).toBe('ok');
  });

  it('bodyKeys denies only when a listed key has a value', async () => {
    expect(() => run(Plain, 'keyed', IMP, { email: 'a@b.c' })).toThrow(ForbiddenException);
    expect(() => run(Plain, 'keyed', IMP, { phone: '017' })).toThrow(ForbiddenException);
    expect(await passes(run(Plain, 'keyed', IMP, { full_name: 'x' }))).toBe('ok');
    expect(await passes(run(Plain, 'keyed', IMP, { email: undefined }))).toBe('ok');
  });

  it('bodyKeys tolerates a missing or non-object body', async () => {
    expect(await passes(run(Plain, 'keyed', IMP, undefined))).toBe('ok');
    expect(await passes(run(Plain, 'keyed', IMP, null))).toBe('ok');
    expect(await passes(run(Plain, 'keyed', IMP, 'email'))).toBe('ok');
  });

  it('bodyKeys route + ordinary token passes even with a listed key', async () => {
    expect(await passes(run(Plain, 'keyed', ORDINARY, { email: 'a@b.c' }))).toBe('ok');
  });

  it('class-level mark covers every handler', () => {
    expect(() => run(Marked, 'a', IMP)).toThrow(ForbiddenException);
    expect(() => run(Marked, 'b', IMP)).toThrow(ForbiddenException);
  });

  it('ignores a stray impSession claim (reads imp only)', async () => {
    expect(await passes(run(Plain, 'marked', { sub: 'u1', impSession: 's' }))).toBe('ok');
  });

  // Smoke with the real controller metadata: PATCH /users/:id {full_name} is not denied,
  // {email} is.
  it('real PATCH /users/:id: full_name passes, email denied', async () => {
    const name = Object.getOwnPropertyNames(UserController.prototype).find(
      (n) =>
        n !== 'constructor' &&
        Reflect.getMetadata('path', (UserController.prototype as any)[n]) === 'users/:id' &&
        Reflect.getMetadata('method', (UserController.prototype as any)[n]) === 4, // RequestMethod.PATCH
    )!;
    expect(name).toBeTruthy();
    expect(await passes(run(UserController, name, IMP, { full_name: 'x' }))).toBe('ok');
    expect(() => run(UserController, name, IMP, { email: 'a@b.c' })).toThrow(ForbiddenException);
  });
});
