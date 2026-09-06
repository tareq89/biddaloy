import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole } from '@biddaloy/shared';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  /**
   * Helper: creates a mock execution context. `handlerPermissions` sets
   * metadata on the handler; `classPermissions` sets it on the class, so
   * we can exercise `getAllAndOverride`'s handler-then-class fallback.
   */
  function createMockContext(
    req: any,
    handlerPermissions?: Permission[],
    classPermissions?: Permission[],
  ) {
    const handler = () => {};
    class TestController {}
    if (handlerPermissions) {
      Reflect.defineMetadata(PERMISSIONS_KEY, handlerPermissions, handler);
    }
    if (classPermissions) {
      Reflect.defineMetadata(PERMISSIONS_KEY, classPermissions, TestController);
    }
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ status: () => ({ json: () => {} }) }),
      }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as any;
  }

  describe('Happy path: no metadata means no restriction', () => {
    it('should allow access when no @RequirePermissions metadata is present', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.STUDENT } };
      const context = createMockContext(req);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access when @RequirePermissions metadata is an empty array', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.STUDENT } };
      const context = createMockContext(req, []);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Happy path: role holds the required permission(s)', () => {
    it('should allow ADMIN, which holds USER_CREATE', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ADMIN } };
      const context = createMockContext(req, [Permission.USER_CREATE]);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow SUPER_ADMIN for any permission, since ROLE_PERMISSIONS grants it everything', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.SUPER_ADMIN } };
      const context = createMockContext(req, [Permission.USER_DELETE]);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should honor class-level metadata when the handler has none', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ADMIN } };
      const context = createMockContext(req, undefined, [Permission.USER_CREATE]);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Error paths: denied access', () => {
    it('should throw 403 when TEACHER lacks USER_CREATE', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.TEACHER } };
      const context = createMockContext(req, [Permission.USER_CREATE]);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('Requires permission(s): USER_CREATE');
    });

    it('should throw 403 naming only the missing permission when ACCOUNTANT holds one of two required', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ACCOUNTANT } };
      const context = createMockContext(req, [Permission.FEE_READ, Permission.USER_CREATE]);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('Requires permission(s): USER_CREATE');
    });

    it('should throw 401 when no currentTenant context exists', () => {
      const req = { currentTenant: undefined };
      const context = createMockContext(req, [Permission.USER_CREATE]);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('No active tenant context');
    });
  });
});
