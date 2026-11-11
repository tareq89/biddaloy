import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import { REQUIRE_APPROVAL_KEY } from '../../auth/decorators/require-approval.decorator';
import { PlatformSettingsController } from './platform-settings.controller';
import { TwoPersonGuard } from './two-person.guard';

const UUID = '0b8f3c1e-5d2a-4f6b-9a7c-1e2d3c4b5a69';
const res: any = { setHeader: vi.fn() };

describe('PlatformSettingsController', () => {
  let settings: any, owners: any, approvals: any, controller: PlatformSettingsController;
  const req = (headers: object = {}): any => ({
    user: { sub: 'u1' },
    method: 'PATCH',
    originalUrl: '/api/v1/platform/settings/approvals',
    body: { enabled: false },
    headers,
  });

  beforeEach(() => {
    settings = { get: vi.fn().mockResolvedValue(true), set: vi.fn().mockResolvedValue(undefined) };
    owners = { activeOwnerIds: vi.fn().mockResolvedValue(['u1', 'u2']) };
    approvals = {
      request: vi.fn().mockResolvedValue({ id: 'req-1' }),
      consume: vi.fn().mockResolvedValue(true),
    };
    // The real guard, so the "off needs the other owner" rule is what is under test.
    const guard = new TwoPersonGuard({} as any, settings, owners, approvals);
    controller = new PlatformSettingsController(settings, guard);
  });

  it('GET reports the switch, on by default', async () => {
    expect(await controller.get(res)).toEqual({ enabled: true });
  });

  it('PATCH needs a step-up token for the switch scope', () => {
    expect(
      Reflect.getMetadata(REQUIRE_APPROVAL_KEY, PlatformSettingsController.prototype.update),
    ).toBe(ApprovalScope.PLATFORM_APPROVALS_SWITCH);
  });

  it('ON needs only the step-up token: no request is filed', async () => {
    settings.get.mockResolvedValue(false);
    expect(await controller.update({ enabled: true }, req())).toEqual({ enabled: true });
    expect(approvals.request).not.toHaveBeenCalled();
    expect(settings.set).toHaveBeenCalledWith('approvals.enabled', true, 'u1');
  });

  it('OFF with both owners active files a request and answers APPROVAL_REQUESTED', async () => {
    await expect(controller.update({ enabled: false }, req())).rejects.toMatchObject({
      response: { details: { code: 'APPROVAL_REQUESTED', requestId: 'req-1' } },
    });
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('OFF with an approved request succeeds', async () => {
    const out = await controller.update({ enabled: false }, req({ 'x-platform-approval': UUID }));
    expect(out).toEqual({ enabled: false });
    expect(settings.set).toHaveBeenCalledWith('approvals.enabled', false, 'u1');
  });

  it('OFF cannot reuse a grant: the second claim is refused and nothing changes', async () => {
    approvals.consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await controller.update({ enabled: false }, req({ 'x-platform-approval': UUID }));
    settings.set.mockClear();
    await expect(
      controller.update({ enabled: false }, req({ 'x-platform-approval': UUID })),
    ).rejects.toMatchObject({ response: { details: { code: 'APPROVAL_INVALID' } } });
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('OFF with one owner locked needs only the step-up token', async () => {
    owners.activeOwnerIds.mockResolvedValue(['u1']);
    expect(await controller.update({ enabled: false }, req())).toEqual({ enabled: false });
    expect(approvals.request).not.toHaveBeenCalled();
  });
});
