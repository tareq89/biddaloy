import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, Permission, roleHasPermission, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { AcrIncompleteRule } from './acr-incomplete.rule';
import { AdmissionApplicationsPendingRule } from './admission-applications-pending.rule';
import { AdmissionIntakeWindowRule } from './admission-intake-window.rule';
import { LeaveMyRequestDecidedRule } from './leave-my-request-decided.rule';
import { LeaveStaffPendingRule } from './leave-staff-pending.rule';
import { StudentsRecordsIncompleteRule } from './students-records-incomplete.rule';

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T04:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
  ...extra,
});

/** Recipient query returns `recipients`; every other query returns `rows`. */
function ds(rows: unknown[], recipients: unknown[] = [{ userId: 'u1', role: UserRole.ADMIN }]) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM user_tenants') ? recipients : rows,
    );
  return { query };
}

// `{decision_en}` / `{decision_bn}` are the same placeholder in two languages.
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].replace(/_(en|bn)$/, '')).sort();

describe('office rules: shared contract', () => {
  const rules = [
    ['admission.applications_pending', new AdmissionApplicationsPendingRule(ds([]) as never)],
    ['admission.intake_window', new AdmissionIntakeWindowRule(ds([]) as never)],
    ['students.records_incomplete', new StudentsRecordsIncompleteRule(ds([]) as never)],
    ['leave.staff_pending', new LeaveStaffPendingRule(ds([]) as never)],
    ['leave.my_request_decided', new LeaveMyRequestDecidedRule(ds([]) as never)],
    ['acr.incomplete', new AcrIncompleteRule(ds([]) as never)],
  ] as const;

  for (const [key, rule] of rules) {
    it(`${key}: meta, matching bn/en placeholders, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key));
      const { en, bn } = rule.messages;
      expect(placeholders(en.title + en.why)).toEqual(placeholders(bn.title + bn.why));
      expect(en.steps.length).toBeLessThanOrEqual(3);
      expect(bn.steps).toHaveLength(en.steps.length);
    });
  }
});

describe('count rules (applications, students, leave pending)', () => {
  it('applications_pending: silent at 0, fires once for the school otherwise', async () => {
    expect(
      await new AdmissionApplicationsPendingRule(ds([{ n: 0 }]) as never).evaluate(ctx()),
    ).toEqual([]);
    const [f] = await new AdmissionApplicationsPendingRule(ds([{ n: 4 }]) as never).evaluate(ctx());
    expect(f).toMatchObject({ dedupeKey: 'school:t1', params: { count: 4 } });
  });

  it('students.records_incomplete: no recipients -> no finding', async () => {
    const rule = new StudentsRecordsIncompleteRule(ds([{ n: 2 }], []) as never);
    expect(await rule.evaluate(ctx())).toEqual([]);
  });

  it('leave.staff_pending: recipient roles are exactly the LEAVE_APPROVE holders among meta.roles', async () => {
    const d = ds([{ n: 2, first_start: '2026-10-12' }]);
    const rule = new LeaveStaffPendingRule(d as never);
    const [f] = await rule.evaluate(ctx());
    expect(f.params).toEqual({ count: 2, firstStart: '2026-10-12' });
    const roleCall = d.query.mock.calls.find((c) => String(c[0]).includes('FROM user_tenants'))!;
    expect(roleCall[1]).toEqual([
      't1',
      rule.meta.roles.filter((r) => roleHasPermission(r, Permission.LEAVE_APPROVE)),
    ]);
  });
});

describe('AdmissionIntakeWindowRule', () => {
  it('uses the tenant-local date for the window (UTC 18:00 is already tomorrow in Dhaka)', async () => {
    const d = ds([]);
    await new AdmissionIntakeWindowRule(d as never).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10' }),
    );
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2026-10-10', '2026-10-13']);
  });

  it('one finding per intake, keyed by the intake', async () => {
    const [f] = await new AdmissionIntakeWindowRule(
      ds([
        { id: 'i1', title: 'Class 6', open_date: '2026-10-11', close_date: '2026-10-30' },
      ]) as never,
    ).evaluate(ctx());
    expect(f).toMatchObject({
      dedupeKey: 'admission_intake:i1',
      subject: { type: 'admission_intake', id: 'i1' },
      params: { title: 'Class 6', openDate: '2026-10-11', closeDate: '2026-10-30' },
      actionUrl: '/admissions/intakes/i1',
    });
  });
});

describe('LeaveMyRequestDecidedRule', () => {
  const row = (status: string) => ({
    id: 'l1',
    status,
    start_date: '2026-10-12',
    end_date: '2026-10-13',
    decided_at: new Date('2026-10-10T01:00:00Z'),
    user_id: 'staff1',
  });

  it('approved row: personal finding, 72h expiry, cutoff = now - 72h', async () => {
    const d = ds([row('APPROVED')]);
    const [f] = await new LeaveMyRequestDecidedRule(d as never).evaluate(ctx());
    expect(f.params).toMatchObject({ decision_en: 'approved', decision_bn: 'অনুমোদিত হয়েছে' });
    expect(f.recipients).toEqual([{ userId: 'staff1', role: null }]);
    expect(f.expiresAt).toEqual(new Date('2026-10-13T01:00:00Z'));
    expect(d.query.mock.calls[0][1]).toEqual(['t1', new Date('2026-10-07T04:00:00Z')]);
  });

  it('rejected row says rejected', async () => {
    const [f] = await new LeaveMyRequestDecidedRule(ds([row('REJECTED')]) as never).evaluate(ctx());
    expect(f.params).toMatchObject({ decision_en: 'rejected', decision_bn: 'নামঞ্জুর হয়েছে' });
  });
});

describe('AcrIncompleteRule', () => {
  const evalWith = (count: number) =>
    new AcrIncompleteRule(
      ds([{ userId: 'ev1', count, first_id: 'a1', first_staff: 's1' }]) as never,
    ).evaluate(ctx());

  it('one draft links straight to it', async () => {
    const [f] = await evalWith(1);
    expect(f.actionUrl).toBe('/staff/s1/acr/a1');
    expect(f.recipients).toEqual([{ userId: 'ev1', role: null }]);
    expect(f.dedupeKey).toBe('user:ev1');
  });

  it('several drafts link to the evaluations list', async () => {
    const [f] = await evalWith(2);
    expect(f.actionUrl).toBe('/staff/evaluations');
  });

  it('cutoff is now - 7 days', async () => {
    const d = ds([]);
    await new AcrIncompleteRule(d as never).evaluate(ctx());
    expect(d.query.mock.calls[0][1]).toEqual(['t1', new Date('2026-10-03T04:00:00Z')]);
  });
});
