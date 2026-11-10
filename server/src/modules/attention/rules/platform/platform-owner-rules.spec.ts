import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { PlatformApprovalPendingRule } from './platform-approval-pending.rule';
import { PlatformRecoveryCodesLowRule } from './platform-recovery-codes-low.rule';

const HOME = 'home-1';
const OWNER_A = { userId: 'a', role: UserRole.SUPER_ADMIN };
const OWNER_B = { userId: 'b', role: UserRole.SUPER_ADMIN };

const ctx = (tenantId = HOME): RuleContext => ({
  tenantId,
  now: new Date('2026-10-10T04:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
});

/** Owner query -> both owners; every other query -> `rows`. */
function ds(rows: unknown[]) {
  return {
    query: vi
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('FROM platform_admins') ? [{ userId: 'a' }, { userId: 'b' }] : rows,
      ),
  };
}
const home = (id: string | undefined) => ({ id: async () => id }) as never;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('platform owner rules: shared contract', () => {
  for (const [key, rule] of [
    ['platform.recovery_codes_low', new PlatformRecoveryCodesLowRule(ds([]) as never, home(HOME))],
    ['platform.approval_pending', new PlatformApprovalPendingRule(ds([]) as never, home(HOME))],
  ] as const) {
    it(`${key}: meta, matching bn/en placeholders, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key));
      const { en, bn } = rule.messages;
      expect(placeholders(en.title + en.why)).toEqual(placeholders(bn.title + bn.why));
      expect(en.steps.length).toBeLessThanOrEqual(3);
    });
  }
});

describe('PlatformRecoveryCodesLowRule', () => {
  it('a finding at 2 codes left, none at 3, each addressed to that owner alone', async () => {
    const d = ds([
      { userId: 'a', left: 2 },
      { userId: 'b', left: 3 },
    ]);
    const out = await new PlatformRecoveryCodesLowRule(d as never, home(HOME)).evaluate(ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      dedupeKey: 'platform:recovery:a',
      params: { count: 2 },
      actionUrl: '/owner-security',
      recipients: [OWNER_A],
    });
  });

  it('nothing off the home sweep, and no query', async () => {
    const d = ds([{ userId: 'a', left: 0 }]);
    const rule = new PlatformRecoveryCodesLowRule(d as never, home(HOME));
    expect(await rule.evaluate(ctx('school-a'))).toEqual([]);
    expect(d.query).not.toHaveBeenCalled();
    expect(
      await new PlatformRecoveryCodesLowRule(d as never, home(undefined)).evaluate(ctx()),
    ).toEqual([]);
  });
});

describe('PlatformApprovalPendingRule', () => {
  const row = {
    id: 'ap1',
    scope: 'platform.owner_lock',
    requestedBy: 'a',
    fullName: 'Alice Owner',
  };

  it('only the other owner receives it, with the first name and a plain scope label', async () => {
    const out = await new PlatformApprovalPendingRule(ds([row]) as never, home(HOME)).evaluate(
      ctx(),
    );
    expect(out).toEqual([
      expect.objectContaining({
        dedupeKey: 'platform:approval:ap1',
        params: { who: 'Alice', what: 'lock an owner' },
        actionUrl: '/platform-owners?tab=approvals',
        recipients: [OWNER_B],
      }),
    ]);
  });

  it('nothing off the home sweep', async () => {
    const d = ds([row]);
    expect(
      await new PlatformApprovalPendingRule(d as never, home(HOME)).evaluate(ctx('x')),
    ).toEqual([]);
    expect(d.query).not.toHaveBeenCalled();
  });
});
