import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole } from '@biddaloy/shared';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AUTHENTICATED_ONLY_KEY } from '../decorators/authenticated-only.decorator';

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
    authenticatedOnly?: { onHandler?: boolean; onClass?: boolean },
  ) {
    const handler = () => {};
    class TestController {}
    if (handlerPermissions) {
      Reflect.defineMetadata(PERMISSIONS_KEY, handlerPermissions, handler);
    }
    if (classPermissions) {
      Reflect.defineMetadata(PERMISSIONS_KEY, classPermissions, TestController);
    }
    if (authenticatedOnly?.onHandler) Reflect.defineMetadata(AUTHENTICATED_ONLY_KEY, true, handler);
    if (authenticatedOnly?.onClass)
      Reflect.defineMetadata(AUTHENTICATED_ONLY_KEY, true, TestController);
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ status: () => ({ json: () => {} }) }),
      }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as any;
  }

  describe('Fail closed: a route must declare what it needs', () => {
    const req = { currentTenant: { id: 'tenant-1', role: UserRole.STUDENT } };

    it('should throw 403 when the route has neither @RequirePermissions nor @AuthenticatedOnly', () => {
      const context = createMockContext(req);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('This route declares no permission');
    });

    it('should throw 403 when @RequirePermissions is an empty array and no @AuthenticatedOnly', () => {
      const context = createMockContext(req, []);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should allow when @AuthenticatedOnly is set on the handler and no permission is declared', () => {
      const context = createMockContext(req, undefined, undefined, { onHandler: true });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow when @AuthenticatedOnly is set on the class', () => {
      const context = createMockContext(req, undefined, undefined, { onClass: true });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should still enforce the permission when both are declared', () => {
      const context = createMockContext(req, [Permission.USER_CREATE], undefined, {
        onHandler: true,
      });

      expect(() => guard.canActivate(context)).toThrow('Requires permission(s): USER_CREATE');
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
