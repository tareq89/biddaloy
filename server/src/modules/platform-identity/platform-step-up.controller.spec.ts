import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ApprovalScope } from '@biddaloy/shared';
import { PlatformStepUpController } from './platform-step-up.controller';

const req: any = {
  ip: '1.1.1.1',
  headers: { 'user-agent': 'ua' },
  user: { sub: 'u1', typ: 'cockpit' },
};
const res: any = { setHeader: vi.fn() };
const dto = (code: string, scope = ApprovalScope.PLATFORM_OWNER_LOCK) => ({ scope, code });

describe('PlatformStepUpController', () => {
  let stepUp: any, mfa: any, attempts: any, home: any, audit: any;
  let controller: PlatformStepUpController;

  beforeEach(() => {
    stepUp = {
      issueForPlatformAdmin: vi
        .fn()
        .mockResolvedValue({ approval_token: 'tok', expires_at: 'soon', jti: 'j1' }),
    };
    mfa = { verifyCode: vi.fn().mockResolvedValue(true) };
    attempts = { isLocked: vi.fn().mockResolvedValue(false), recordFailure: vi.fn() };
    home = { id: vi.fn().mockResolvedValue('home-1') };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    controller = new PlatformStepUpController(stepUp, mfa, attempts, home, audit);
  });

  it('a right code gives a token bound to actor, scope and home, audited with tenant NULL', async () => {
    const out = await controller.issue(dto('123456'), req, res);
    expect(out).toEqual({ approval_token: 'tok', expires_at: 'soon' });
    expect(stepUp.issueForPlatformAdmin).toHaveBeenCalledWith(
      'u1',
      ApprovalScope.PLATFORM_OWNER_LOCK,
      'home-1',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: null, entity_id: 'j1', performed_by_user_id: 'u1' }),
    );
  });

  it('a wrong or replayed code fails with one fixed sentence and counts on the cockpit key', async () => {
    mfa.verifyCode.mockResolvedValue(false); // wrong, or already used in this 30 s step
    const messages: string[] = [];
    for (const code of ['000000', '123456']) {
      await controller.issue(dto(code), req, res).catch((e: UnauthorizedException) => {
        expect(e).toBeInstanceOf(UnauthorizedException);
        messages.push(e.message);
      });
    }
    expect(messages).toHaveLength(2);
    expect(new Set(messages).size).toBe(1);
    expect(attempts.recordFailure).toHaveBeenCalledWith('cockpit:user:u1');
    expect(stepUp.issueForPlatformAdmin).not.toHaveBeenCalled();
  });

  it('a recovery-code shape is refused and never reaches the verifier', async () => {
    await expect(controller.issue(dto('abcd-efgh'), req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mfa.verifyCode).not.toHaveBeenCalled();
    expect(attempts.recordFailure).toHaveBeenCalled();
  });

  it('a locked owner is refused before any code check', async () => {
    attempts.isLocked.mockResolvedValue(true);
    await expect(controller.issue(dto('123456'), req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mfa.verifyCode).not.toHaveBeenCalled();
  });

  it('a non-platform scope is refused by the service and writes no audit row', async () => {
    stepUp.issueForPlatformAdmin.mockRejectedValue(new Error('Unknown approval scope'));
    await expect(
      controller.issue(dto('123456', ApprovalScope.FEES_DISCOUNT), req, res),
    ).rejects.toThrow('Unknown approval scope');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
