import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { ContextGuard, RolesGuard } from './context.guard';
import { UserRole, SchoolStatus } from '@biddaloy/shared';
import { TenantStatusService } from '../../schools/tenant-status.service';

const PLATFORM_TENANT_ID = 'platform-tenant';

// ============================================================================
// ContextGuard Tests
// ============================================================================
describe('ContextGuard', () => {
  let guard: ContextGuard;
  let reflector: Reflector;
  let tenantStatus: {
    isActive: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    findSchoolIdBySlug: ReturnType<typeof vi.fn>;
  };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reflector = new Reflector();
    // Defaults to "active"/ACTIVE so every pre-existing test (which predates
    // suspension enforcement) keeps passing unchanged.
    tenantStatus = {
      isActive: vi.fn().mockResolvedValue(true),
      getStatus: vi.fn().mockResolvedValue(SchoolStatus.ACTIVE),
      // Not found by default — most tests below rely on an explicitly
      // configured PLATFORM_TENANT_ID and never need dynamic resolution;
      // the ones that do (see "dynamic platform tenant resolution" below)
      // override this per-test.
      findSchoolIdBySlug: vi.fn().mockResolvedValue(null),
    };
    // Blanket mock: every ConfigService.get() call (PLATFORM_TENANT_ID,
    // NODE_ENV, ...) returns this same truthy, non-'production' string —
    // fine, since an explicitly configured PLATFORM_TENANT_ID always wins
    // over the NODE_ENV check in `resolvePlatformTenantId`.
    configService = { get: vi.fn().mockReturnValue(PLATFORM_TENANT_ID) };
    guard = new ContextGuard(
      reflector,
      tenantStatus as unknown as TenantStatusService,
      configService as any,
    );
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
      tenantStatus.getStatus.mockResolvedValue(SchoolStatus.SUSPENDED);
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
      expect(tenantStatus.getStatus).toHaveBeenCalledWith('tenant-1');
    });

    it('should allow access via another ACTIVE tenant membership for the same user', async () => {
      tenantStatus.getStatus.mockImplementation((tenantId: string) =>
        Promise.resolve(tenantId === 'tenant-2' ? SchoolStatus.ACTIVE : SchoolStatus.SUSPENDED),
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

    it('[14.13.3] grants a platform SUPER_ADMIN access to a tenant they hold no membership in', async () => {
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        // 'new-school-tenant' has no matching membership at all — a
        // just-provisioned school the SUPER_ADMIN was never added to.
        headers: { 'x-tenant-id': 'new-school-tenant' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.currentTenant).toEqual({ id: 'new-school-tenant', role: UserRole.SUPER_ADMIN });
      // Unlike their OWN platform tenant, an "elsewhere" target IS resolved
      // — it must exist and be ACTIVE, just refused via platform authority
      // rather than a membership row.
      expect(tenantStatus.getStatus).toHaveBeenCalledWith('new-school-tenant');
    });

    it('[14.13.3] gives a platform SUPER_ADMIN a clean 401 for a nonexistent target tenant', async () => {
      tenantStatus.getStatus.mockResolvedValue(null);
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'no-such-tenant' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('[14.13.3] refuses a platform SUPER_ADMIN a SUSPENDED target tenant (no accidental override)', async () => {
      tenantStatus.getStatus.mockResolvedValue(SchoolStatus.SUSPENDED);
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'suspended-school' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('[14.13.3] refuses a SUPER_ADMIN an explicit non-SUPER_ADMIN role in a tenant they hold no membership in', async () => {
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'new-school-tenant', 'x-role': UserRole.ADMIN },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('[14.13.3] still refuses a non-SUPER_ADMIN with no membership in the target tenant', async () => {
      const req = {
        user: {
          sub: 'teacher-1',
          email: 'teacher@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.TEACHER }],
        },
        headers: { 'x-tenant-id': 'other-tenant' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'User is not a member of tenant other-tenant',
      );
    });

    it('should not check tenant status for a SUPER_ADMIN on their OWN platform tenant', async () => {
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': PLATFORM_TENANT_ID },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(tenantStatus.getStatus).not.toHaveBeenCalled();
    });

    // --- Security regression: privilege escalation via tenant-local SUPER_ADMIN ---
    it("[SECURITY] a tenant-local SUPER_ADMIN (minted by that tenant's own ADMIN, not on the platform tenant) cannot reach another tenant", async () => {
      const req = {
        user: {
          sub: 'rogue-1',
          email: 'rogue@school-a.test',
          phone: null,
          // A SUPER_ADMIN membership that lives on an ordinary school
          // tenant, NOT the platform tenant — exactly what a school A
          // ADMIN could mint today via the (separately tracked) users.dto
          // gap. Must NOT be treated as platform authority.
          memberships: [{ tenantId: 'school-a', role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'school-b' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'User is not a member of tenant school-b',
      );
    });

    it('[SECURITY] with PLATFORM_TENANT_ID unset, no membership grants platform authority (fail closed)', async () => {
      configService.get.mockReturnValue(undefined);
      guard = new ContextGuard(
        reflector,
        tenantStatus as unknown as TenantStatusService,
        configService as any,
      );
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'new-school-tenant' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('[14.13.3 item 3] lets a platform SUPER_ADMIN who ALSO holds an unrelated membership in the target tenant in as SUPER_ADMIN', async () => {
      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [
            { tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN },
            // Also a plain ADMIN of the school they're managing — the
            // client always sends X-Role: SUPER_ADMIN, which previously
            // matched nothing in this tenant's memberships and 401'd.
            { tenantId: 'joined-school', role: UserRole.ADMIN },
          ],
        },
        headers: { 'x-tenant-id': 'joined-school', 'x-role': UserRole.SUPER_ADMIN },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.currentTenant).toEqual({ id: 'joined-school', role: UserRole.SUPER_ADMIN });
    });
  });

  /**
   * #620 fix: outside production, with `PLATFORM_TENANT_ID` unset, the
   * platform tenant is no longer assumed to be a hardcoded id — no real
   * database has one, since the `MultiTenantAuth` migration creates the
   * "Default School" row with a random uuid. `ContextGuard` instead
   * discovers it dynamically via `TenantStatusService.findSchoolIdBySlug`
   * and caches the result.
   */
  describe('Dynamic platform tenant resolution outside production (#620)', () => {
    const DISCOVERED_ID = 'discovered-platform-tenant-uuid';

    function buildGuard(nodeEnv: string | undefined) {
      configService = {
        get: vi.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
      };
      return new ContextGuard(
        reflector,
        tenantStatus as unknown as TenantStatusService,
        configService as any,
      );
    }

    it('discovers the platform tenant by slug and lets a SUPER_ADMIN on it reach another tenant', async () => {
      tenantStatus.findSchoolIdBySlug.mockResolvedValue(DISCOVERED_ID);
      guard = buildGuard('development');

      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: DISCOVERED_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'some-other-school' },
      };
      const context = createMockContext(req);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.currentTenant).toEqual({ id: 'some-other-school', role: UserRole.SUPER_ADMIN });
      expect(tenantStatus.findSchoolIdBySlug).toHaveBeenCalledWith('default-school');
    });

    it('caches the discovered id — only queries the DB once across multiple requests', async () => {
      tenantStatus.findSchoolIdBySlug.mockResolvedValue(DISCOVERED_ID);
      guard = buildGuard('test');

      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: DISCOVERED_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'some-other-school' },
      };

      await guard.canActivate(createMockContext(req));
      await guard.canActivate(createMockContext({ ...req }));

      expect(tenantStatus.findSchoolIdBySlug).toHaveBeenCalledTimes(1);
    });

    it('[SECURITY] a tenant-local SUPER_ADMIN (not a member of the discovered platform tenant) still cannot reach another tenant', async () => {
      tenantStatus.findSchoolIdBySlug.mockResolvedValue(DISCOVERED_ID);
      guard = buildGuard('development');

      const req = {
        user: {
          sub: 'rogue-1',
          email: 'rogue@school-a.test',
          phone: null,
          // A SUPER_ADMIN membership on an ordinary school, not on the
          // dynamically-discovered platform tenant.
          memberships: [{ tenantId: 'school-a', role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'school-b' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'User is not a member of tenant school-b',
      );
    });

    it('[SECURITY] never resolves dynamically in production — stays fail-closed even with a matching row in the DB', async () => {
      tenantStatus.findSchoolIdBySlug.mockResolvedValue(DISCOVERED_ID);
      guard = buildGuard('production');

      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: DISCOVERED_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'some-other-school' },
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      // Production never even attempts the DB lookup — PLATFORM_TENANT_ID
      // unset in production must be an explicit ops decision, not something
      // dynamic discovery quietly papers over.
      expect(tenantStatus.findSchoolIdBySlug).not.toHaveBeenCalled();
    });

    it('does not cache a failed lookup — a later request can still discover the tenant once it exists', async () => {
      guard = buildGuard('development');
      tenantStatus.findSchoolIdBySlug.mockResolvedValueOnce(null);

      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: DISCOVERED_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'some-other-school' },
      };

      // First request: school not seeded yet — fails closed, not a crash.
      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );

      // Second request: seeding has completed since — succeeds without a
      // restart.
      tenantStatus.findSchoolIdBySlug.mockResolvedValueOnce(DISCOVERED_ID);
      const result = await guard.canActivate(createMockContext({ ...req }));

      expect(result).toBe(true);
      expect(tenantStatus.findSchoolIdBySlug).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Regression for a review finding on #620: only a platform SUPER_ADMIN's
   * membership-less cross-tenant path reaches `TenantStatusService.getStatus`
   * with fully unvalidated input (everyone else 401s at the membership check
   * first). A malformed (non-uuid) `X-Tenant-ID` there hit Postgres 22P02 on
   * the uuid-typed `id` lookup and surfaced as an unhandled 500, not a 401.
   *
   * Uses a REAL `TenantStatusService` (only its `redis`/`schoolRepo`
   * dependencies are faked) wired into a real `ContextGuard`, so this
   * exercises the actual failure path end-to-end rather than a
   * `getStatus` mock that pre-empts the bug by never hitting the DB at all.
   */
  describe('Malformed X-Tenant-ID from a platform SUPER_ADMIN (#620 review)', () => {
    it('gets a clean 401, not a 500, for a non-uuid X-Tenant-ID', async () => {
      const redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() };
      const invalidUuidError = new QueryFailedError(
        'SELECT * FROM schools WHERE id = $1',
        ['not-a-uuid'],
        new Error('invalid input syntax for type uuid: "not-a-uuid"'),
      );
      (invalidUuidError as unknown as { code: string }).code = '22P02';
      const schoolRepo = { findOne: vi.fn().mockRejectedValue(invalidUuidError) };
      const realTenantStatus = new TenantStatusService(redis as any, schoolRepo as any);

      const realGuard = new ContextGuard(
        reflector,
        realTenantStatus,
        configService as any, // still returns PLATFORM_TENANT_ID — a platform SUPER_ADMIN
      );

      const req = {
        user: {
          sub: 'super-1',
          email: 'super@test.com',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'not-a-uuid' },
      };
      const context = createMockContext(req);

      await expect(realGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(realGuard.canActivate(context)).rejects.toThrow(
        'Tenant not-a-uuid does not exist',
      );
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
