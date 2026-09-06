import { describe, it, expect } from 'vitest';
import { ROLES_KEY, Roles } from './roles.decorator';
import { PERMISSIONS_KEY, RequirePermissions } from './require-permissions.decorator';
import { Permission } from '@biddaloy/shared';
import { Reflector } from '@nestjs/core';

/**
 * Unit tests for custom decorators.
 *
 * For @CurrentTenant and @CurrentUser, we test the Reflector metadata
 * and the decorator's behavior indirectly through the guards.
 * The decorators themselves are simple pass-through wrappers.
 *
 * @Roles is a SetMetadata decorator, which we can test directly.
 */

describe('@Roles decorator', () => {
  const reflector = new Reflector();

  it('should set metadata on the decorated handler', () => {
    const target = () => {};
    Roles('ADMIN', 'ACCOUNTANT')(target, 'test', undefined);

    const metadata = reflector.get(ROLES_KEY, target);
    expect(metadata).toEqual(['ADMIN', 'ACCOUNTANT']);
  });

  it('should allow a single role argument', () => {
    const target = () => {};
    Roles('ADMIN')(target, 'test', undefined);

    const metadata = reflector.get(ROLES_KEY, target);
    expect(metadata).toEqual(['ADMIN']);
  });

  it('should return empty array when no roles specified', () => {
    const target = () => {};
    Roles()(target, 'test', undefined);

    const metadata = reflector.get(ROLES_KEY, target);
    expect(metadata).toEqual([]);
  });

  it('should work with class-level decorator', () => {
    @Roles('ADMIN')
    class TestController {}

    const metadata = reflector.get(ROLES_KEY, TestController);
    expect(metadata).toEqual(['ADMIN']);
  });
});

describe('@Roles decorator metadata key', () => {
  it('should export the correct metadata key', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});

describe('@RequirePermissions decorator', () => {
  const reflector = new Reflector();

  it('should set metadata on the decorated handler', () => {
    const target = () => {};
    RequirePermissions(Permission.USER_CREATE, Permission.USER_READ)(target, 'test', undefined);

    const metadata = reflector.get(PERMISSIONS_KEY, target);
    expect(metadata).toEqual([Permission.USER_CREATE, Permission.USER_READ]);
  });

  it('should allow a single permission argument', () => {
    const target = () => {};
    RequirePermissions(Permission.USER_CREATE)(target, 'test', undefined);

    const metadata = reflector.get(PERMISSIONS_KEY, target);
    expect(metadata).toEqual([Permission.USER_CREATE]);
  });

  it('should return empty array when no permissions specified', () => {
    const target = () => {};
    RequirePermissions()(target, 'test', undefined);

    const metadata = reflector.get(PERMISSIONS_KEY, target);
    expect(metadata).toEqual([]);
  });

  it('should work with class-level decorator', () => {
    @RequirePermissions(Permission.USER_CREATE)
    class TestController {}

    const metadata = reflector.get(PERMISSIONS_KEY, TestController);
    expect(metadata).toEqual([Permission.USER_CREATE]);
  });
});

describe('@RequirePermissions decorator metadata key', () => {
  it('should export the correct metadata key', () => {
    expect(PERMISSIONS_KEY).toBe('permissions');
  });
});
