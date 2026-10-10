import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { AttentionRule, RuleContext } from '../rule.types';
import { CommsFailedMessagesRule } from './comms-failed-messages.rule';
import { CommsSmsCreditLowRule } from './comms-sms-credit-low.rule';
import { isBackupUnhealthy, SystemBackupFailedRule } from './system-backup-failed.rule';

const ctxAt = (iso: string): RuleContext => ({
  tenantId: 'T',
  now: new Date(iso),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '11:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
});
const ctx = ctxAt('2026-10-10T05:00:00Z');
const ADMIN_ROWS = [{ userId: 'a1', role: UserRole.ADMIN }];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

function expectMessagesSane(rule: AttentionRule, key: string, params: Record<string, unknown>) {
  expect(rule.meta).toEqual(alertRuleMeta(key as never));
  for (const lang of ['en', 'bn'] as const) {
    const m = rule.messages[lang];
    expect(m.steps.length).toBeLessThanOrEqual(3);
    for (const p of [m.title, m.why, ...m.steps, m.action ?? ''].flatMap(placeholders)) {
      expect(Object.keys(params)).toContain(p);
    }
  }
  const en = placeholders(rule.messages.en.title + rule.messages.en.why);
  const bn = placeholders(rule.messages.bn.title + rule.messages.bn.why);
  expect(bn.filter((p) => !en.includes(p))).toEqual([]);
}

describe('CommsSmsCreditLowRule', () => {
  const make = (metered: boolean, available: number) => {
    const ds = { query: vi.fn().mockResolvedValue(ADMIN_ROWS) };
    const credits = {
      isMetered: vi.fn().mockResolvedValue(metered),
      getBalance: vi.fn().mockResolvedValue({ available, reserved: 0 }),
    };
    return { rule: new CommsSmsCreditLowRule(ds as never, credits as never), credits };
  };

  it('ignores unmetered schools without reading a balance', async () => {
    const { rule, credits } = make(false, 0);
    expect(await rule.evaluate(ctx)).toEqual([]);
    expect(credits.getBalance).not.toHaveBeenCalled();
  });

  it('fires below the threshold (200) and clears at it', async () => {
    const { rule } = make(true, 150);
    const [f] = await rule.evaluate(ctx);
    expect(f.params).toEqual({ available: 150, threshold: 200 });
    expectMessagesSane(rule, 'comms.sms_credit_low', f.params);
    expect(await make(true, 200).rule.evaluate(ctx)).toEqual([]);
  });
});

describe('CommsFailedMessagesRule', () => {
  const make = (n: number) => {
    const ds = { query: vi.fn().mockResolvedValueOnce([{ n }]).mockResolvedValueOnce(ADMIN_ROWS) };
    return { rule: new CommsFailedMessagesRule(ds as never), ds };
  };
  // Local midnight in Dhaka.
  const midnight = ctxAt('2026-10-09T18:00:00Z');

  it('counts failures from the 24h before now, tenant-scoped', async () => {
    const { rule, ds } = make(0);
    await rule.evaluate(midnight);
    expect(ds.query.mock.calls[0][1]).toEqual(['T', new Date('2026-10-08T18:00:00Z')]);
  });

  it('fires at the threshold (10), not below', async () => {
    expect(await make(9).rule.evaluate(midnight)).toEqual([]);
    const { rule } = make(10);
    const [f] = await rule.evaluate(midnight);
    expect(f.params).toEqual({ count: 10 });
    expectMessagesSane(rule, 'comms.failed_messages', f.params);
  });
});

describe('isBackupUnhealthy', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const DAY = 86_400_000;
  const base = { lastStatus: 'DONE', lastSuccessAt: null, schoolCreatedAt: ago(100 * DAY) };

  it('OFF is never unhealthy; a failed last job always is', () => {
    expect(isBackupUnhealthy({ ...base, schedule: 'OFF', lastStatus: 'FAILED' }, now)).toBe(false);
    expect(isBackupUnhealthy({ ...base, schedule: 'DAILY', lastStatus: 'FAILED' }, now)).toBe(true);
  });

  it('WEEKLY goes stale just past 8 days', () => {
    const w = { ...base, schedule: 'WEEKLY' as const };
    expect(isBackupUnhealthy({ ...w, lastSuccessAt: ago(8 * DAY + 1000) }, now)).toBe(true);
    expect(isBackupUnhealthy({ ...w, lastSuccessAt: ago(7 * DAY) }, now)).toBe(false);
  });

  it('a school that never backed up is judged from its creation date', () => {
    const d = { ...base, schedule: 'DAILY' as const };
    expect(isBackupUnhealthy({ ...d, schoolCreatedAt: ago(3 * DAY) }, now)).toBe(true);
    expect(isBackupUnhealthy({ ...d, schoolCreatedAt: ago(DAY) }, now)).toBe(false);
  });
});

describe('SystemBackupFailedRule', () => {
  const make = (schedule: string | undefined, row: object) => {
    const ds = { query: vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce(ADMIN_ROWS) };
    const schools = {
      getResolvedSettings: vi.fn().mockResolvedValue({ backup: schedule && { schedule } }),
    };
    return { rule: new SystemBackupFailedRule(ds as never, schools as never), ds };
  };
  const old = new Date('2026-01-01T00:00:00Z');

  it('does not even query when the schedule is OFF/unset', async () => {
    const { rule, ds } = make(undefined, {});
    expect(await rule.evaluate(ctx)).toEqual([]);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('shows the last success as a LOCAL date, not the UTC date', async () => {
    const { rule } = make('DAILY', {
      last_status: 'FAILED',
      // 18:30Z is already the next day in Dhaka (UTC+6).
      last_success_at: new Date('2026-10-09T18:30:00Z'),
      school_created_at: old,
    });
    const [f] = await rule.evaluate(ctx);
    expect(f.params).toEqual({ lastSuccess: '2026-10-10' });
    expectMessagesSane(rule, 'system.backup_failed', f.params);
  });

  it('shows a dash when there was never a successful backup', async () => {
    const { rule } = make('DAILY', {
      last_status: 'FAILED',
      last_success_at: null,
      school_created_at: old,
    });
    expect((await rule.evaluate(ctx))[0].params).toEqual({ lastSuccess: '—' });
  });
});
