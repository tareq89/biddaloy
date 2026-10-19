import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { ContextGuard, RolesGuard } from './context.guard';
import { UserRole, SchoolStatus } from '@biddaloy/shared';
import { TenantStatusService } from '../../schools/tenant-status.service';
import { ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY } from '../decorators/allow-when-suspended-for-billing.decorator';

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
    getStatusReason: ReturnType<typeof vi.fn>;
    isSuspendedForBilling: ReturnType<typeof vi.fn>;
    isRestoring: ReturnType<typeof vi.fn>;
    platformTenantId: ReturnType<typeof vi.fn>;
    getReadOnlyUntil: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    reflector = new Reflector();
    // Defaults to "active"/ACTIVE so every pre-existing test (which predates
    // suspension enforcement) keeps passing unchanged.
    tenantStatus = {
      isActive: vi.fn().mockResolvedValue(true),
      getStatus: vi.fn().mockResolvedValue(SchoolStatus.ACTIVE),
      getStatusReason: vi.fn().mockResolvedValue(null),
      isSuspendedForBilling: vi.fn().mockResolvedValue(false),
      isRestoring: vi.fn().mockResolvedValue(false),
      // Platform designation lives in TenantStatusService (its own spec covers env/prod/slug rules).
      platformTenantId: vi.fn().mockResolvedValue(PLATFORM_TENANT_ID),
      getReadOnlyUntil: vi.fn().mockResolvedValue(null),
    };
    guard = new ContextGuard(reflector, tenantStatus as unknown as TenantStatusService);
  });

  /**
   * Helper: creates a mock execution context with the given request.
   */
  function createMockContext(req: any, handler: () => void = () => {}) {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ status: () => ({ json: () => {} }) }),
      }),
      getHandler: () => handler,
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

    it('picks TEACHER over EXAM_CONTROLLER and COMMITTEE over PARENT (D23)', async () => {
      const run = async (roles: string[]) => {
        const req: any = {
          user: {
            sub: 'user-1',
            email: 'test@test.com',
            phone: null,
            memberships: roles.map((role) => ({ tenantId: 'tenant-1', role })),
          },
          headers: { 'x-tenant-id': 'tenant-1' },
        };
        await guard.canActivate(createMockContext(req));
        return req.currentTenant.role;
      };
      expect(await run(['EXAM_CONTROLLER', 'TEACHER'])).toBe('TEACHER');
      expect(await run(['PARENT', 'COMMITTEE'])).toBe('COMMITTEE');
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

  describe('Restore freeze (#2210)', () => {
    const restoreReq = (method: string, memberships: any[], tenantId = 'tenant-1') => ({
      method,
      user: { sub: 'user-1', email: 'a@b.c', phone: null, memberships },
      headers: { 'x-tenant-id': tenantId },
    });
    const adminOf = [{ tenantId: 'tenant-1', role: UserRole.ADMIN }];

    it('refuses a POST with 423 TENANT_RESTORING while a restore runs', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      const context = createMockContext(restoreReq('POST', adminOf));

      const error: any = await guard.canActivate(context).catch((e) => e);

      expect(error.getStatus()).toBe(423);
      expect(error.getResponse().details).toEqual({ code: 'TENANT_RESTORING' });
    });

    it('refuses a PUT while a restore runs', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      await expect(
        guard.canActivate(createMockContext(restoreReq('PUT', adminOf))),
      ).rejects.toMatchObject({ status: 423 });
    });

    it('refuses a PATCH while a restore runs', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      await expect(
        guard.canActivate(createMockContext(restoreReq('PATCH', adminOf))),
      ).rejects.toMatchObject({ status: 423 });
    });

    it('refuses a DELETE while a restore runs', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      await expect(
        guard.canActivate(createMockContext(restoreReq('DELETE', adminOf))),
      ).rejects.toMatchObject({ status: 423 });
    });

    it('still allows a GET while a restore runs (read-only, not closed)', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      await expect(guard.canActivate(createMockContext(restoreReq('GET', adminOf)))).resolves.toBe(
        true,
      );
    });

    it('allows a POST when no restore runs', async () => {
      await expect(guard.canActivate(createMockContext(restoreReq('POST', adminOf)))).resolves.toBe(
        true,
      );
    });

    it('refuses a platform SUPER_ADMIN write on their own tenant while it restores', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      const memberships = [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }];

      await expect(
        guard.canActivate(createMockContext(restoreReq('POST', memberships, PLATFORM_TENANT_ID))),
      ).rejects.toMatchObject({ status: 423 });
    });

    it('still lets that platform SUPER_ADMIN read while it restores', async () => {
      tenantStatus.isRestoring.mockResolvedValue(true);
      const memberships = [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }];

      await expect(
        guard.canActivate(createMockContext(restoreReq('GET', memberships, PLATFORM_TENANT_ID))),
      ).resolves.toBe(true);
    });
  });

  describe('Seat-grace read-only window (Epic 49 D9)', () => {
    const UNTIL = new Date('2027-01-07T18:00:00.000Z');
    const adminOf = [{ tenantId: 'tenant-1', role: UserRole.ADMIN }];
    const call = (method: string, handler: () => void = () => {}, tenantId = 'tenant-1') =>
      guard.canActivate(
        createMockContext(
          {
            method,
            user: { sub: 'user-1', email: 'a@b.c', phone: null, memberships: adminOf },
            headers: { 'x-tenant-id': tenantId },
          },
          handler,
        ),
      );
    beforeEach(() => tenantStatus.getReadOnlyUntil.mockResolvedValue(UNTIL));

    it('lets a GET through during grace', async () => {
      await expect(call('GET')).resolves.toBe(true);
    });

    it('lets a HEAD through during grace', async () => {
      await expect(call('HEAD')).resolves.toBe(true);
    });

    it('lets an OPTIONS through during grace', async () => {
      await expect(call('OPTIONS')).resolves.toBe(true);
    });

    // Same message and code for every write (Rule 23).
    const readOnly403 = {
      status: 403,
      response: {
        message: 'This school is read-only',
        details: { code: 'TENANT_READ_ONLY', until: UNTIL.toISOString() },
      },
    };

    it('refuses a POST with 403 TENANT_READ_ONLY and the until date', async () => {
      await expect(call('POST')).rejects.toMatchObject(readOnly403);
    });

    it('refuses a PUT with 403 TENANT_READ_ONLY', async () => {
      await expect(call('PUT')).rejects.toMatchObject(readOnly403);
    });

    it('refuses a PATCH with 403 TENANT_READ_ONLY', async () => {
      await expect(call('PATCH')).rejects.toMatchObject(readOnly403);
    });

    it('refuses a DELETE with 403 TENANT_READ_ONLY', async () => {
      await expect(call('DELETE')).rejects.toMatchObject(readOnly403);
    });

    it('lets an @AllowWhenSuspendedForBilling POST through so the school can pay', async () => {
      const h = () => {};
      Reflect.defineMetadata(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, true, h);
      await expect(call('POST', h)).resolves.toBe(true);
    });

    it('lets a write through when the school is not over its seats', async () => {
      tenantStatus.getReadOnlyUntil.mockResolvedValue(null);
      await expect(call('POST')).resolves.toBe(true);
    });

    it('never applies to the platform tenant', async () => {
      const req = {
        method: 'POST',
        user: {
          sub: 'user-1',
          email: 'a@b.c',
          phone: null,
          memberships: [{ tenantId: PLATFORM_TENANT_ID, role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': PLATFORM_TENANT_ID },
      };
      await expect(guard.canActivate(createMockContext(req))).resolves.toBe(true);
      expect(tenantStatus.getReadOnlyUntil).not.toHaveBeenCalled();
    });

    it("tenant B's write is judged on tenant B's own window (isolation)", async () => {
      tenantStatus.getReadOnlyUntil.mockImplementation(async (id: string) =>
        id === 'tenant-1' ? UNTIL : null,
      );
      const both = [
        { tenantId: 'tenant-1', role: UserRole.ADMIN },
        { tenantId: 'tenant-2', role: UserRole.ADMIN },
      ];
      const req = (tenantId: string) => ({
        method: 'POST',
        user: { sub: 'user-1', email: 'a@b.c', phone: null, memberships: both },
        headers: { 'x-tenant-id': tenantId },
      });
      await expect(guard.canActivate(createMockContext(req('tenant-1')))).rejects.toMatchObject({
        status: 403,
      });
      await expect(guard.canActivate(createMockContext(req('tenant-2')))).resolves.toBe(true);
    });

    it('after the daily job suspends the school the answer is TENANT_SUSPENDED with the reason', async () => {
      tenantStatus.getStatus.mockResolvedValue(SchoolStatus.SUSPENDED);
      tenantStatus.getStatusReason.mockResolvedValue('SEATS_EXPIRED');
      await expect(call('GET')).rejects.toMatchObject({
        status: 403,
        response: { details: { code: 'TENANT_SUSPENDED', reason: 'SEATS_EXPIRED' } },
      });
    });
  });

  describe('Trial-expired export exception (D16, #2266)', () => {
    const req = () => ({
      user: {
        sub: 'user-1',
        email: 'test@test.com',
        phone: null,
        memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
      },
      headers: { 'x-tenant-id': 'tenant-1' },
    });
    const marked = () => {
      const h = () => {};
      Reflect.defineMetadata(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, true, h);
      return h;
    };
    const suspend = (reason: string | null) => {
      tenantStatus.getStatus.mockResolvedValue(SchoolStatus.SUSPENDED);
      tenantStatus.getStatusReason.mockResolvedValue(reason);
      // The fresh (uncached) DB read agrees with the cache unless a test says otherwise.
      tenantStatus.isSuspendedForBilling.mockResolvedValue(reason === 'TRIAL_EXPIRED');
    };

    it('lets a marked handler through for SUSPENDED + TRIAL_EXPIRED and sets currentTenant', async () => {
      suspend('TRIAL_EXPIRED');
      const r: any = req();
      await expect(guard.canActivate(createMockContext(r, marked()))).resolves.toBe(true);
      expect(r.currentTenant).toEqual({ id: 'tenant-1', role: UserRole.ADMIN });
    });

    it('still 403s an unmarked handler for TRIAL_EXPIRED, with the reason', async () => {
      suspend('TRIAL_EXPIRED');
      const error = (await guard
        .canActivate(createMockContext(req()))
        .catch((e) => e)) as ForbiddenException;
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toEqual({
        message: 'This school has been suspended',
        details: { code: 'TENANT_SUSPENDED', reason: 'TRIAL_EXPIRED' },
      });
    });

    it('still 403s a marked handler when the suspension has no reason', async () => {
      suspend(null);
      await expect(guard.canActivate(createMockContext(req(), marked()))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('still 403s a marked handler when the suspension has another reason', async () => {
      suspend('NON_PAYMENT');
      await expect(guard.canActivate(createMockContext(req(), marked()))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('ignores a mark on the class: only the handler can open the route', async () => {
      suspend('TRIAL_EXPIRED');
      class Marked {}
      Reflect.defineMetadata(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, true, Marked);
      const ctx = { ...createMockContext(req()), getClass: () => Marked };
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it("does not let tenant A's expired trial open a different suspended tenant B", async () => {
      tenantStatus.getStatus.mockResolvedValue(SchoolStatus.SUSPENDED);
      tenantStatus.getStatusReason.mockImplementation((id: string) =>
        Promise.resolve(id === 'tenant-1' ? 'TRIAL_EXPIRED' : null),
      );
      const r: any = {
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-2', role: UserRole.ADMIN }],
        },
        headers: { 'x-tenant-id': 'tenant-2' },
      };
      await expect(guard.canActivate(createMockContext(r, marked()))).rejects.toThrow(
        ForbiddenException,
      );
    });

    // #2399 A2: status and reason sit in two cache keys, so a stale cached TRIAL_EXPIRED can pair
    // with a fresh SUSPENDED after a manual re-suspension. The allow decision reads the DB.
    it('refuses a marked handler when the cache still says TRIAL_EXPIRED but the DB no longer does', async () => {
      suspend('TRIAL_EXPIRED');
      tenantStatus.isSuspendedForBilling.mockResolvedValue(false);
      await expect(guard.canActivate(createMockContext(req(), marked()))).rejects.toThrow(
        ForbiddenException,
      );
      expect(tenantStatus.isSuspendedForBilling).toHaveBeenCalledWith('tenant-1');
    });

    it('does not open a marked handler when the status is not SUSPENDED, even with reason TRIAL_EXPIRED', async () => {
      suspend('TRIAL_EXPIRED');
      tenantStatus.getStatus.mockResolvedValue('ARCHIVED');
      await expect(guard.canActivate(createMockContext(req(), marked()))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('still refuses an allowed export with 423 while a restore runs (restore check comes after)', async () => {
      suspend('TRIAL_EXPIRED');
      tenantStatus.isRestoring.mockResolvedValue(true);
      const r: any = { ...req(), method: 'POST' };
      const error: any = await guard.canActivate(createMockContext(r, marked())).catch((e) => e);
      expect(error.getStatus()).toBe(423);
      expect(error.getResponse().details).toEqual({ code: 'TENANT_RESTORING' });
    });

    it('leaves a marked handler on an ACTIVE tenant unaffected', async () => {
      const r: any = req();
      await expect(guard.canActivate(createMockContext(r, marked()))).resolves.toBe(true);
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

    it('adds details.reason TRIAL_EXPIRED when the trial is what suspended the school', async () => {
      tenantStatus.getStatus.mockResolvedValue(SchoolStatus.SUSPENDED);
      tenantStatus.getStatusReason.mockResolvedValue('TRIAL_EXPIRED');
      const context = createMockContext({
        user: {
          sub: 'user-1',
          email: 'test@test.com',
          phone: null,
          memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
        },
        headers: { 'x-tenant-id': 'tenant-1' },
      });

      const error = (await guard.canActivate(context).catch((e) => e)) as ForbiddenException;
      expect(error.getResponse()).toEqual({
        message: 'This school has been suspended',
        details: { code: 'TENANT_SUSPENDED', reason: 'TRIAL_EXPIRED' },
      });
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
      expect(req).toMatchObject({ isPlatformSuperAdmin: true });
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
    it('[SECURITY] a tenant-local SUPER_ADMIN acting on their own tenant is not flagged platform', async () => {
      const req = {
        user: {
          sub: 'rogue-1',
          email: 'rogue@school-a.test',
          phone: null,
          memberships: [{ tenantId: 'school-a', role: UserRole.SUPER_ADMIN }],
        },
        headers: { 'x-tenant-id': 'school-a' },
      };

      await guard.canActivate(createMockContext(req));

      expect(req).toMatchObject({ isPlatformSuperAdmin: false });
    });

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
      tenantStatus.platformTenantId.mockResolvedValue(undefined);
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
      const realTenantStatus = new TenantStatusService(
        redis as any,
        schoolRepo as any,
        {
          get: vi.fn().mockReturnValue(PLATFORM_TENANT_ID), // a platform SUPER_ADMIN
        } as any,
      );

      const realGuard = new ContextGuard(reflector, realTenantStatus);

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

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
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
