import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole } from '@biddaloy/shared';
import { ModuleKey } from '@biddaloy/shared';
import { MODULE_OFF_MESSAGE } from '../../../common/filters/known-errors';
import { REQUIRES_MODULE_KEY } from '../decorators/require-module.decorator';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AUTHENTICATED_ONLY_KEY } from '../decorators/authenticated-only.decorator';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  const act = async (c: any) => guard.canActivate(c);
  let forTenant: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reflector = new Reflector();
    forTenant = vi.fn().mockResolvedValue({ platform: {}, school: {} });
    guard = new PermissionsGuard(reflector, { forTenant } as any);
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

    it('should throw 403 when the route has neither @RequirePermissions nor @AuthenticatedOnly', async () => {
      const context = createMockContext(req);

      await expect(act(context)).rejects.toThrow(ForbiddenException);
      await expect(act(context)).rejects.toThrow('This route declares no permission');
    });

    it('should throw 403 when @RequirePermissions is an empty array and no @AuthenticatedOnly', async () => {
      const context = createMockContext(req, []);

      await expect(act(context)).rejects.toThrow(ForbiddenException);
    });

    it('should allow when @AuthenticatedOnly is set on the handler and no permission is declared', async () => {
      const context = createMockContext(req, undefined, undefined, { onHandler: true });

      expect(await act(context)).toBe(true);
    });

    it('should allow when @AuthenticatedOnly is set on the class', async () => {
      const context = createMockContext(req, undefined, undefined, { onClass: true });

      expect(await act(context)).toBe(true);
    });

    it('should still enforce the permission when both are declared', async () => {
      const context = createMockContext(req, [Permission.USER_CREATE], undefined, {
        onHandler: true,
      });

      await expect(act(context)).rejects.toThrow('Requires permission(s): USER_CREATE');
    });
  });

  describe('Happy path: role holds the required permission(s)', () => {
    it('should allow ADMIN, which holds USER_CREATE', async () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ADMIN } };
      const context = createMockContext(req, [Permission.USER_CREATE]);

      expect(await act(context)).toBe(true);
    });

    it('should allow SUPER_ADMIN for any permission, since ROLE_PERMISSIONS grants it everything', async () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.SUPER_ADMIN } };
      const context = createMockContext(req, [Permission.USER_DELETE]);

      expect(await act(context)).toBe(true);
    });

    it('should honor class-level metadata when the handler has none', async () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ADMIN } };
      const context = createMockContext(req, undefined, [Permission.USER_CREATE]);

      expect(await act(context)).toBe(true);
    });
  });

  describe('Error paths: denied access', () => {
    it('should throw 403 when TEACHER lacks USER_CREATE', async () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.TEACHER } };
      const context = createMockContext(req, [Permission.USER_CREATE]);

      await expect(act(context)).rejects.toThrow(ForbiddenException);
      await expect(act(context)).rejects.toThrow('Requires permission(s): USER_CREATE');
    });

    it('should throw 403 naming only the missing permission when ACCOUNTANT holds one of two required', async () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ACCOUNTANT } };
      const context = createMockContext(req, [Permission.FEE_READ, Permission.USER_CREATE]);

      await expect(act(context)).rejects.toThrow(ForbiddenException);
      await expect(act(context)).rejects.toThrow('Requires permission(s): USER_CREATE');
    });

    it('should throw 401 when no currentTenant context exists', async () => {
      const req = { currentTenant: undefined };
      const context = createMockContext(req, [Permission.USER_CREATE]);

      await expect(act(context)).rejects.toThrow(UnauthorizedException);
      await expect(act(context)).rejects.toThrow('No active tenant context');
    });
  });

  describe('[Epic 77] @RequiresModule', () => {
    const ctx = (role: UserRole, opts: { authOnly?: boolean; perm?: Permission[] } = {}) => {
      const context = createMockContext(
        { currentTenant: { id: 't1', role } },
        opts.perm ?? (opts.authOnly ? undefined : [Permission.FEE_READ]),
        undefined,
        { onHandler: opts.authOnly },
      );
      Reflect.defineMetadata(REQUIRES_MODULE_KEY, ModuleKey.fees, context.getClass());
      return context;
    };
    const state = (school: any, platform: any = {}) =>
      forTenant.mockResolvedValue({ platform, school });

    it('403 with the fixed sentence when the school turned it off', async () => {
      state({ fees: { on: false } });
      await expect(act(ctx(UserRole.ADMIN))).rejects.toThrow(MODULE_OFF_MESSAGE);
    });

    it('role off: TEACHER 403, ADMIN passes', async () => {
      state({ attendance: { offForRoles: [UserRole.TEACHER] } });
      const c = (role: UserRole) => {
        const x = ctx(role, { perm: [Permission.FEE_READ] });
        Reflect.defineMetadata(REQUIRES_MODULE_KEY, ModuleKey.attendance, x.getClass());
        return x;
      };
      await expect(act(c(UserRole.ACCOUNTANT))).resolves.toBe(true);
      state({ attendance: { offForRoles: [UserRole.ACCOUNTANT] } });
      await expect(act(c(UserRole.ACCOUNTANT))).rejects.toThrow(MODULE_OFF_MESSAGE);
      await expect(act(c(UserRole.ADMIN))).resolves.toBe(true);
    });

    it('dependency off (fines needs fees) gives the same sentence', async () => {
      state({ fees: { on: false } });
      const x = ctx(UserRole.ADMIN);
      Reflect.defineMetadata(REQUIRES_MODULE_KEY, ModuleKey.fines, x.getClass());
      await expect(act(x)).rejects.toThrow(MODULE_OFF_MESSAGE);
    });

    it('platform off gives the same sentence', async () => {
      state({}, { fees: false });
      await expect(act(ctx(UserRole.ADMIN))).rejects.toThrow(MODULE_OFF_MESSAGE);
    });

    it('undecorated route never reads module state', async () => {
      const context = createMockContext({ currentTenant: { id: 't1', role: UserRole.ADMIN } }, [
        Permission.USER_CREATE,
      ]);
      expect(await act(context)).toBe(true);
      expect(forTenant).not.toHaveBeenCalled();
    });

    it('@AuthenticatedOnly handler in a tagged controller is 403 when off, passes when on', async () => {
      state({ fees: { on: false } });
      await expect(act(ctx(UserRole.ADMIN, { authOnly: true }))).rejects.toThrow(
        MODULE_OFF_MESSAGE,
      );
      state({});
      await expect(act(ctx(UserRole.ADMIN, { authOnly: true }))).resolves.toBe(true);
    });

    it('missing permission wins first and the reader is not called', async () => {
      state({ fees: { on: false } });
      await expect(act(ctx(UserRole.TEACHER, { perm: [Permission.USER_CREATE] }))).rejects.toThrow(
        'Requires permission(s): USER_CREATE',
      );
      expect(forTenant).not.toHaveBeenCalled();
    });

    it('fails closed: a reader error propagates', async () => {
      forTenant.mockRejectedValue(new Error('db down'));
      await expect(act(ctx(UserRole.ADMIN))).rejects.toThrow('db down');
    });

    it('no tenant context on an authenticated-only route skips the module check', async () => {
      const context = createMockContext({}, undefined, undefined, { onHandler: true });
      Reflect.defineMetadata(REQUIRES_MODULE_KEY, ModuleKey.fees, context.getClass());
      expect(await act(context)).toBe(true);
    });
  });
});
