import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, CommunicationMedium, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { RuleContext } from '../rule.types';
import { CommsDailyLimitReachedRule } from './comms-daily-limit-reached.rule';

const ctx: RuleContext = {
  tenantId: 'T',
  now: new Date('2026-10-10T05:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '11:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
};
const ADMIN_ROWS = [{ userId: 'a1', role: UserRole.ADMIN }];

const make = (hit: CommunicationMedium[], admins = ADMIN_ROWS) => {
  const ds = { query: vi.fn().mockResolvedValue(admins) };
  const limits = {
    hitToday: vi.fn().mockResolvedValue(hit),
    remaining: vi.fn().mockResolvedValue({ limit: 500, remaining: 0 }),
  };
  return new CommsDailyLimitReachedRule(ds as never, limits as never);
};

describe('CommsDailyLimitReachedRule', () => {
  it('uses the catalogue meta', () => {
    expect(make([]).meta).toEqual(alertRuleMeta('comms.daily_limit_reached'));
  });

  it('no flag -> no finding', async () => {
    expect(await make([]).evaluate(ctx)).toEqual([]);
  });

  it('SMS flag -> one finding, once per channel per day', async () => {
    const f = await make([CommunicationMedium.SMS]).evaluate(ctx);
    expect(f).toHaveLength(1);
    expect(f[0].dedupeKey).toBe('school:T:SMS:2026-10-10');
    expect(f[0].params).toEqual({ channel: 'SMS', limit: 500 });
    expect(f[0].recipients).toEqual([{ userId: 'a1', role: UserRole.ADMIN }]);
  });

  it('two channels -> two findings', async () => {
    const f = await make([CommunicationMedium.SMS, CommunicationMedium.EMAIL]).evaluate(ctx);
    expect(f.map((x) => x.dedupeKey)).toEqual([
      'school:T:SMS:2026-10-10',
      'school:T:EMAIL:2026-10-10',
    ]);
  });

  it('no admins -> none', async () => {
    expect(await make([CommunicationMedium.SMS], []).evaluate(ctx)).toEqual([]);
  });

  it('uses the plain words (D13): no banned word in en, "দিনের সীমা" in bn', () => {
    const { en, bn } = make([]).messages;
    const enText = [en.title, en.why, ...en.steps, en.action].join(' ').toLowerCase();
    for (const w of ['cap', 'quota', 'rate limit', 'throttle']) {
      expect(enText).not.toMatch(new RegExp(`\\b${w}\\b`));
    }
    expect([bn.title, bn.why, ...bn.steps].join(' ')).toContain('দিনের সীমা');
  });
});
