import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ApprovalScope } from '@biddaloy/shared';
import { REQUIRE_APPROVAL_KEY } from '../../auth/decorators/require-approval.decorator';
import { PlatformAdminGuard } from '../platform-admin.guard';
import { PlatformApprovalsController } from './platform-approvals.controller';

describe('PlatformApprovalsController', () => {
  const svc: any = { list: vi.fn().mockResolvedValue([{ id: 'x' }]), decide: vi.fn() };
  const controller = new PlatformApprovalsController(svc);
  const res: any = { setHeader: vi.fn() };

  it('lists for any owner (class guards only, no approval needed)', async () => {
    expect(await controller.list({ status: 'PENDING', limit: 10 }, res)).toEqual([{ id: 'x' }]);
    expect(svc.list).toHaveBeenCalledWith('PENDING', 10);
    expect(
      Reflect.getMetadata(REQUIRE_APPROVAL_KEY, PlatformApprovalsController.prototype.list),
    ).toBeUndefined();
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformApprovalsController);
    expect(guards).toContain(PlatformAdminGuard);
  });

  it('approve and deny need the platform_approval_decide approval token', () => {
    for (const fn of [
      PlatformApprovalsController.prototype.approve,
      PlatformApprovalsController.prototype.deny,
    ]) {
      expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, fn)).toBe(
        ApprovalScope.PLATFORM_APPROVAL_DECIDE,
      );
    }
  });

  it('approve and deny pass the signed-in owner as the approver', async () => {
    const req: any = { user: { sub: 'u2' } };
    await controller.approve('id-1', req);
    await controller.deny('id-2', req);
    expect(svc.decide).toHaveBeenNthCalledWith(1, 'id-1', 'u2', 'approve');
    expect(svc.decide).toHaveBeenNthCalledWith(2, 'id-2', 'u2', 'deny');
  });
});
