import { describe, it, expect, vi } from 'vitest';
import { DAILY_LIMITS_PLATFORM_KEY } from '@biddaloy/shared';
import { SendLimitService } from './send-limit.service';
import { PlatformDailyLimitsService } from './platform-daily-limits.service';

function make(opts: { school?: unknown; platform?: unknown } = {}) {
  const redis = { get: vi.fn().mockResolvedValue(null), eval: vi.fn(), exists: vi.fn() };
  const schools = {
    getDecryptedSettings: vi
      .fn()
      .mockResolvedValue({ communications: { dailyLimits: opts.school } }),
    updateSettings: vi.fn().mockResolvedValue({}),
  };
  const cache = { getOrLoad: (_id: string, load: () => Promise<unknown>) => load() };
  const platform = { get: vi.fn().mockResolvedValue(opts.platform), set: vi.fn() };
  const limits = new SendLimitService(redis as any, schools as any, cache as any, platform as any);
  const svc = new PlatformDailyLimitsService(platform as any, schools as any, limits);
  return { svc, platform, schools };
}

describe('PlatformDailyLimitsService', () => {
  it('null removes a platform value, untouched keys stay', async () => {
    const { svc, platform } = make({ platform: { sms: 5, email: 6 } });
    await svc.putPlatform({ sms: null }, 'actor');
    expect(platform.set).toHaveBeenCalledWith(DAILY_LIMITS_PLATFORM_KEY, { email: 6 }, 'actor');
  });

  it('a platform PUT sets a value and invalidates the cached default', async () => {
    const { svc, platform } = make({ platform: {} });
    await svc.putPlatform({ whatsapp: 9, showRemaining: true }, 'a');
    expect(platform.set).toHaveBeenCalledWith(
      DAILY_LIMITS_PLATFORM_KEY,
      { whatsapp: 9, showRemaining: true },
      'a',
    );
    expect(platform.get).toHaveBeenCalledTimes(3); // read stored, then GET reads stored + defaults
  });

  it('effective chain: school, then platform, then code default', async () => {
    const { svc } = make({ school: { sms: 1 }, platform: { sms: 9, email: 7 } });
    const v = await svc.getSchool('s');
    expect(v.stored).toEqual({ sms: 1 });
    expect(v.effective).toMatchObject({ sms: 1, email: 7, whatsapp: 2000 });
  });

  it('showRemaining follows the same chain', async () => {
    expect(
      (
        await make({
          school: { showRemaining: false },
          platform: { showRemaining: true },
        }).svc.getSchool('s')
      ).effective.showRemaining,
    ).toBe(false);
    expect(
      (await make({ platform: { showRemaining: true } }).svc.getSchool('s')).effective
        .showRemaining,
    ).toBe(true);
    expect((await make().svc.getSchool('s')).effective.showRemaining).toBe(false);
  });

  it('platform GET has usedToday null', async () => {
    expect((await make().svc.getPlatform()).usedToday).toBeNull();
  });

  it('school PUT passes nulls through with the platform-admin flag', async () => {
    const { svc, schools } = make();
    await svc.putSchool('s', { sms: null, email: 3 }, 'a', { ip: null, userAgent: null });
    expect(schools.updateSettings).toHaveBeenCalledWith(
      's',
      { communications: { dailyLimits: { sms: null, email: 3 } } },
      'a',
      { ip: null, userAgent: null },
      true,
    );
  });
});
