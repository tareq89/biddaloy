import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { RolesGuard } from '../../auth/guards/context.guard';
import { SchoolAdminsController } from './school-admins.controller';

/**
 * Contract: "Non-SUPER_ADMIN caller → 403 on all four routes." The class
 * carries `@Roles(SUPER_ADMIN)` (rather than repeating it per-method, as
 * `ProvisioningController` does) — same `RolesGuard`, reading
 * `getClass()` when a handler has no method-level override, so one check
 * per handler is enough to prove all four are covered.
 */
describe('SchoolAdminsController — SUPER_ADMIN only', () => {
  const guard = new RolesGuard(new Reflector());

  const handlers = [
    SchoolAdminsController.prototype.list,
    SchoolAdminsController.prototype.addAdmin,
    SchoolAdminsController.prototype.resendInvitation,
    SchoolAdminsController.prototype.revokeInvitation,
  ];

  it.each(handlers)('denies a non-SUPER_ADMIN caller with 401/403 at the RolesGuard', (handler) => {
    const context: any = {
      getHandler: () => handler,
      getClass: () => SchoolAdminsController,
      switchToHttp: () => ({
        getRequest: () => ({ currentTenant: { id: 'tenant-x', role: UserRole.ADMIN } }),
      }),
    };
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it.each(handlers)('allows a SUPER_ADMIN caller', (handler) => {
    const context: any = {
      getHandler: () => handler,
      getClass: () => SchoolAdminsController,
      switchToHttp: () => ({
        getRequest: () => ({ currentTenant: { id: 'tenant-x', role: UserRole.SUPER_ADMIN } }),
      }),
    };
    expect(guard.canActivate(context)).toBe(true);
  });
});
