import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthTokenPurpose, UserStatus } from '@biddaloy/shared';
import { RecoveryService } from './recovery.service';

// [Epic 98] A platform owner recovers on the cockpit host only. The app host sends nothing
// and answers like it does for an unknown account.
describe('RecoveryService with a platform owner', () => {
  let user: any;
  let isOwner: boolean;
  let delivery: any;
  let authTokens: any;
  let otp: any;
  let authService: any;
  let svc: RecoveryService;

  beforeEach(() => {
    user = {
      id: 'u1',
      email: 'one@x.com',
      phone: '01711111111',
      status: UserStatus.ACTIVE,
      full_name: 'Owner',
    };
    isOwner = true;
    delivery = {
      deliver: vi.fn(),
      detach: vi.fn(async (_f: string, work: () => Promise<unknown>) => work()),
    };
    authTokens = {
      issue: vi.fn(),
      verify: vi.fn().mockResolvedValue({
        status: 'valid',
        row: { id: 'row1', user_id: 'u1', metadata: { email: 'one@x.com' } },
      }),
      consume: vi.fn(),
    };
    otp = { request: vi.fn(), verify: vi.fn().mockResolvedValue('ok') };
    authService = {
      hasLiveMembership: vi.fn().mockResolvedValue(true),
      primaryTenantId: vi.fn().mockResolvedValue('tenant-1'),
      startSession: vi.fn(),
    };
    const userRepo = {
      findOne: vi.fn(async () => user),
      manager: { getRepository: () => ({ exists: vi.fn(async () => isOwner) }) },
    };
    svc = new RecoveryService(
      userRepo as any,
      {} as any,
      {} as any,
      otp,
      authTokens,
      delivery,
      authService,
      {} as any,
      {} as any,
      { record: vi.fn() } as any,
      { get: () => undefined } as any,
    );
  });

  it('forgot-password on the app host sends nothing and answers generically', async () => {
    expect(await svc.forgot('one@x.com', { ip: null, userAgent: null })).toEqual({});
    expect(authTokens.issue).not.toHaveBeenCalled();
    expect(otp.request).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('forgot-password for an ordinary user still sends the link (no regression)', async () => {
    isOwner = false;
    authTokens.issue.mockResolvedValue({ raw: 'RAW' });
    await svc.forgot('one@x.com', { ip: null, userAgent: null });
    expect(authTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: AuthTokenPurpose.PASSWORD_RESET }),
    );
  });

  it("reset-password with an owner's link on the app host is refused and burns nothing", async () => {
    // The user row for the token's owner is found, then refused as an owner.
    const err: any = await svc
      .reset({ token: 'RAW', new_password: 'Correct-Horse-Battery-9!' } as any, {
        ip: null,
        userAgent: null,
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid or expired link');
    expect(authTokens.consume).not.toHaveBeenCalled();
    expect(authService.startSession).not.toHaveBeenCalled();
  });

  it("reset-password with an owner's phone code on the app host is refused with the generic code answer", async () => {
    const err: any = await svc
      .reset(
        { phone: '01711111111', otp: '123456', new_password: 'Correct-Horse-Battery-9!' } as any,
        { ip: null, userAgent: null },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid or expired code');
    expect(authService.startSession).not.toHaveBeenCalled();
  });
});
