import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import { PLATFORM_APPROVAL_SCOPES } from './step-up.service';
import { PlatformBillingController } from '../billing/platform-billing.controller';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';

describe('PLATFORM_APPROVAL_SCOPES', () => {
  // The cockpit step-up refuses any scope not on this list, so a platform scope missing here
  // makes every route behind it impossible to approve. New `platform.*` scopes must be added.
  it('lists every platform.* approval scope', () => {
    const platformScopes = Object.values(ApprovalScope).filter((s) => s.startsWith('platform.'));
    expect([...PLATFORM_APPROVAL_SCOPES].sort()).toEqual(platformScopes.sort());
  });
});

describe('platform routes behind @RequireApproval', () => {
  // ApprovalGuard checks a platform token's `tid` against `request.platformScopeTenantId`, which
  // only PlatformAdminGuard sets. A controller with approval routes but no PlatformAdminGuard
  // answers every real owner with 401 "No active session context" (the refund routes did).
  it('the billing controller carries PlatformAdminGuard next to its refund routes', () => {
    const guards: unknown[] = Reflect.getMetadata('__guards__', PlatformBillingController) ?? [];
    expect(guards).toContain(PlatformAdminGuard);
  });
});
