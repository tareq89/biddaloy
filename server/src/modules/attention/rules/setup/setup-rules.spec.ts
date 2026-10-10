import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, EMPLOYEE_ROLES, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { AttentionRule, RuleContext } from '../rule.types';
import { CommsProviderMissingRule } from './comms-provider-missing.rule';
import { SetupIncompleteRule } from './setup-incomplete.rule';
import { StaffInvitePendingRule } from './staff-invite-pending.rule';
import { YearNextMissingRule } from './year-next-missing.rule';

const ctxAt = (iso: string, localDate: string): RuleContext => ({
  tenantId: 'T',
  now: new Date(iso),
  tz: 'Asia/Dhaka',
  localDate,
  localTime: '00:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
});
const ctx = ctxAt('2026-10-09T05:00:00Z', '2026-10-09');
const ADMIN_ROWS = [{ userId: 'a1', role: UserRole.ADMIN }];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** Every message placeholder must be a param the rule really sets, in both languages. */
function expectMessagesSane(rule: AttentionRule, key: string, params: Record<string, unknown>) {
  expect(rule.meta).toEqual(alertRuleMeta(key as never));
  for (const lang of ['en', 'bn'] as const) {
    const m = rule.messages[lang];
    expect(m.steps.length).toBeLessThanOrEqual(3);
    for (const p of [m.title, m.why, ...m.steps, m.action ?? ''].flatMap(placeholders)) {
      expect(Object.keys(params)).toContain(p);
    }
  }
  const all = (l: 'en' | 'bn') =>
    [...new Set([rule.messages[l].title, rule.messages[l].why].flatMap(placeholders))].sort();
  // bn may drop a placeholder only if en lacks it too.
  expect(all('bn').filter((p) => !all('en').includes(p))).toEqual([]);
}

const items = (flags: boolean[]) => flags.map((done, i) => ({ id: `i${i}`, done }));

describe('SetupIncompleteRule', () => {
  const make = (status: object, admins: unknown[] = ADMIN_ROWS) => {
    const ds = { query: vi.fn().mockResolvedValue(admins) };
    const onboarding = { getStatus: vi.fn().mockResolvedValue(status) };
    return { rule: new SetupIncompleteRule(ds as never, onboarding as never), ds, onboarding };
  };
  const eight = (notDone: number) =>
    items([...Array(8 - notDone).fill(true), ...Array(notDone).fill(false)]);

  it('fires with done/total, to ADMINs of the tenant', async () => {
    const { rule, ds } = make({ finished_at: null, items: eight(1) });
    const [f] = await rule.evaluate(ctx);
    expect(f).toMatchObject({
      dedupeKey: 'school:T',
      params: { done: 7, total: 8 },
      actionUrl: '/welcome',
      recipients: ADMIN_ROWS,
    });
    // Recipient query is tenant-scoped and uses the rule's own roles.
    expect(ds.query.mock.calls[0][1]).toEqual(['T', rule.meta.roles]);
    expectMessagesSane(rule, 'setup.incomplete', f.params);
  });

  it('is clear once finished, or when every item is done', async () => {
    expect(await make({ finished_at: 'x', items: eight(1) }).rule.evaluate(ctx)).toEqual([]);
    expect(await make({ finished_at: null, items: eight(0) }).rule.evaluate(ctx)).toEqual([]);
  });

  it('returns nothing when the school has no active ADMIN', async () => {
    expect(await make({ finished_at: null, items: eight(1) }, []).rule.evaluate(ctx)).toEqual([]);
  });
});

describe('CommsProviderMissingRule', () => {
  const make = (communications: unknown) => {
    const ds = { query: vi.fn().mockResolvedValue(ADMIN_ROWS) };
    const schools = { getResolvedSettings: vi.fn().mockResolvedValue({ communications }) };
    return new CommsProviderMissingRule(ds as never, schools as never);
  };

  it('fires when neither SMS nor email is configured', async () => {
    const rule = make(undefined);
    const [f] = await rule.evaluate(ctx);
    expect(f.actionUrl).toBe('/settings?section=communication');
    expectMessagesSane(rule, 'comms.provider_missing', f.params);
  });

  it('is clear with SMS or with email', async () => {
    expect(await make({ sms: {} }).evaluate(ctx)).toEqual([]);
    expect(await make({ email: {} }).evaluate(ctx)).toEqual([]);
  });
});

describe('StaffInvitePendingRule', () => {
  const make = (n: number) => {
    const ds = {
      query: vi.fn().mockResolvedValueOnce([{ n }]).mockResolvedValueOnce(ADMIN_ROWS),
    };
    return { rule: new StaffInvitePendingRule(ds as never), ds };
  };

  it('is clear when nobody is pending', async () => {
    expect(await make(0).rule.evaluate(ctx)).toEqual([]);
  });

  it('fires with the count and never counts SUPER_ADMIN', async () => {
    const { rule, ds } = make(3);
    const [f] = await rule.evaluate(ctx);
    expect(f.params).toEqual({ count: 3 });
    expect(ds.query.mock.calls[0][1][0]).toBe('T');
    const roles = ds.query.mock.calls[0][1][1];
    expect(roles).not.toContain(UserRole.SUPER_ADMIN);
    expect(roles).toEqual(EMPLOYEE_ROLES.filter((r) => r !== UserRole.SUPER_ADMIN));
    expectMessagesSane(rule, 'staff.invite_pending', f.params);
  });
});

describe('YearNextMissingRule', () => {
  const make = (rows: unknown[]) => {
    const ds = { query: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(ADMIN_ROWS) };
    return { rule: new YearNextMissingRule(ds as never), ds };
  };

  it('looks 45 days ahead of the LOCAL date, not the UTC date', async () => {
    // 23:59 in Dhaka is still 2026-10-09 → +45d = 2026-11-23.
    const a = make([]);
    await a.rule.evaluate(ctxAt('2026-10-09T17:59:00Z', '2026-10-09'));
    expect(a.ds.query.mock.calls[0][1]).toEqual(['T', '2026-11-23']);
    // Local midnight rolls the date over.
    const b = make([]);
    await b.rule.evaluate(ctxAt('2026-10-09T18:00:00Z', '2026-10-10'));
    expect(b.ds.query.mock.calls[0][1]).toEqual(['T', '2026-11-24']);
  });

  it('fires per academic year', async () => {
    const { rule } = make([{ id: 'Y1', name: '2026', end_date: '2026-12-31' }]);
    const [f] = await rule.evaluate(ctx);
    expect(f).toMatchObject({
      dedupeKey: 'academic_year:Y1',
      subject: { type: 'academic_year', id: 'Y1' },
      params: { year: '2026', endDate: '2026-12-31' },
    });
    expectMessagesSane(rule, 'year.next_missing', f.params);
  });
});
