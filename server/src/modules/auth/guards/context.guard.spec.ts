import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ContextGuard, RolesGuard } from './context.guard';
import { UserRole } from '@biddaloy/shared';
import { TenantStatusService } from '../../schools/tenant-status.service';

// ============================================================================
// ContextGuard Tests
// ============================================================================
describe('ContextGuard', () => {
  let guard: ContextGuard;
  let reflector: Reflector;
  let tenantStatus: { isActive: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reflector = new Reflector();
    // Defaults to "active" so every pre-existing test (which predates
    // suspension enforcement) keeps passing unchanged.
    tenantStatus = { isActive: vi.fn().mockResolvedValue(true) };
    guard = new ContextGuard(reflector, tenantStatus as unknown as TenantStatusService);
  });

  /**
   * Helper: creates a mock execution context with the given request.
   */
  function createMockContext(req: any) {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ status: () => ({ json: () => {} }) }),
      }),
      getHandler: () => () => {},
      getClass: () => class {},
    } as any;
  }

  describe('Happy path: valid tenant context', () => {
    it('should allow access when X-Tenant-ID matches a membership', async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: { 'x-tenant-id': 'tenant-1' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.currentTenant).toEqual({ id: 'tenant-1', role: UserRole.ADMIN });
    });

    it('should resolve the highest-priority role when user has multiple roles in the same tenant', async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [
            { tenantId: 'tenant-1', role: UserRole.STUDENT }, // priority 50
            { tenantId: 'tenant-1', role: UserRole.TEACHER }, // priority 70
          ],
        },
        headers: { 'x-tenant-id': 'tenant-1' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      // TEACHER (70) > STUDENT (50), so TEACHER wins
      expect(req.currentTenant.role).toBe(UserRole.TEACHER);
    });

    it('should keep the earlier role when it already has the highest priority', async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [
            { tenantId: 'tenant-1', role: UserRole.TEACHER }, // priority 70
            { tenantId: 'tenant-1', role: UserRole.STUDENT }, // priority 50
          ],
        },
        headers: { 'x-tenant-id': 'tenant-1' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      // TEACHER (70) > STUDENT (50), so the earlier-seen TEACHER is kept
      expect(req.currentTenant.role).toBe(UserRole.TEACHER);
    });

    it('should use X-Role header when explicitly provided', async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [
            { tenantId: 'tenant-1', role: UserRole.STUDENT },
            { tenantId: 'tenant-1', role: UserRole.TEACHER },
          ],
        },
        headers: {
          'x-tenant-id': 'tenant-1',
          'x-role': UserRole.STUDENT,
        },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      // Explicit X-Role overrides priority
      expect(req.currentTenant.role).toBe(UserRole.STUDENT);
    });
  });

  describe('Error paths: missing or invalid context', () => {
    it('should throw 401 when no user is attached (no JWT)', async () => {
      const req = {
        user: undefined,
        headers: { 'x-tenant-id': 'tenant-1' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Authentication required');
    });

    it('should throw 401 when X-Tenant-ID header is missing', async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: {},
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('X-Tenant-ID header is required');
    });

    it("should throw 401 when X-Tenant-ID is not in the user's memberships", async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: { 'x-tenant-id': 'other-tenant' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'User is not a member of tenant other-tenant',
      );
    });

    it("should throw 401 when explicit X-Role is not found in the tenant's memberships", async () => {
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: {
          'x-tenant-id': 'tenant-1',
          'x-role': UserRole.TEACHER,
        },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'User is not a member of tenant tenant-1',
      );
    });

    it('should return null when explicit X-Role is not found (resolveRole internal path)', async () => {
      // This tests the explicit role lookup returning null
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: {
          'x-tenant-id': 'tenant-1',
          'x-role': UserRole.TEACHER,
        },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Tenant suspension (#527)', () => {
    it('should throw 403 with code TENANT_SUSPENDED for a suspended tenant', async () => {
      tenantStatus.isActive.mockResolvedValue(false);
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: { 'x-tenant-id': 'tenant-1' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      try {
        await guard.canActivate(context);
        throw new Error('expected canActivate to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toEqual({
          message: 'This school has been suspended',
          details: { code: 'TENANT_SUSPENDED' },
        });
      }
      expect(tenantStatus.isActive).toHaveBeenCalledWith('tenant-1');
    });

    it('should allow access via another ACTIVE tenant membership for the same user', async () => {
      tenantStatus.isActive.mockImplementation((tenantId: string) =>
        Promise.resolve(tenantId === 'tenant-2'),
      );
      const req = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [
            { tenantId: 'tenant-1', role: UserRole.ADMIN }, // suspended
            { tenantId: 'tenant-2', role: UserRole.ADMIN }, // active
          ],
        },
        headers: { 'x-tenant-id': 'tenant-2' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.currentTenant).toEqual({ id: 'tenant-2', role: UserRole.ADMIN });
    });

    it('should not check tenant status for a SUPER_ADMIN (platform routes)', async () => {
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: 'platform-tenant', role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'platform-tenant' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(tenantStatus.isActive).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// RolesGuard Tests
// ============================================================================
describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  /**
   * Helper: creates a mock context with the given handler metadata.
   */
  function createMockContext(req: any, roles?: string[]) {
    // Set metadata on the handler
    const handler = () => {};
    if (roles) {
      Reflect.defineMetadata('roles', roles, handler);
    }
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ status: () => ({ json: () => {} }) }),
      }),
      getHandler: () => handler,
      getClass: () => class {},
    } as any;
  }

  describe('Happy path: role authorization', () => {
    it('should allow access when the user has a required role', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.ADMIN } };
      const context = createMockContext(req, [UserRole.ADMIN, UserRole.ACCOUNTANT]);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access to SUPER_ADMIN for any endpoint', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.SUPER_ADMIN } };
      // SUPER_ADMIN bypasses all checks
      const context = createMockContext(req, [UserRole.TEACHER]);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access when no @Roles decorator is present (role-agnostic endpoint)', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.STUDENT } };
      // No metadata set — no roles required
      const context = createMockContext(req);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Error paths: denied access', () => {
    it('should throw 403 when the user does not have a required role', () => {
      const req = { currentTenant: { id: 'tenant-1', role: UserRole.STUDENT } };
      const context = createMockContext(req, [UserRole.ADMIN]);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Requires one of roles: ADMIN');
    });

    it('should throw 401 when no tenant context exists', () => {
      const req = { currentTenant: undefined };
      const context = createMockContext(req, [UserRole.ADMIN]);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('No active tenant context');
    });
  });
});
