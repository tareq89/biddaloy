import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { FeesOverdueRisingRule } from './fees-overdue-rising.rule';
import { FeesRemindersPendingRule } from './fees-reminders-pending.rule';
import { FeesStructureMissingNewYearRule } from './fees-structure-missing-new-year.rule';
import { FeesUnassignedStudentsRule } from './fees-unassigned-students.rule';

const ACCOUNTANT = { userId: 'u1', role: UserRole.ACCOUNTANT };

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

/** The recipients query returns the ACCOUNTANT; every other query returns `rows`. */
function ds(rows: unknown[]) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM user_tenants') ? [ACCOUNTANT] : rows,
    );
  return { query };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('fees rules: shared contract', () => {
  const rules = [
    ['fees.overdue_rising', new FeesOverdueRisingRule(ds([]) as never)],
    ['fees.reminders_pending', new FeesRemindersPendingRule(ds([]) as never)],
    ['fees.unassigned_students', new FeesUnassignedStudentsRule(ds([]) as never)],
    ['fees.structure_missing_new_year', new FeesStructureMissingNewYearRule(ds([]) as never)],
  ] as const;

  for (const [key, rule] of rules) {
    it(`${key}: meta, matching bn/en placeholders, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key));
      const { en, bn } = rule.messages;
      expect(placeholders(en.title + en.why + en.steps.join())).toEqual(
        placeholders(bn.title + bn.why + bn.steps.join()),
      );
      expect(en.steps.length).toBeLessThanOrEqual(3);
      expect(bn.steps).toHaveLength(en.steps.length);
    });
  }
});

describe('FeesOverdueRisingRule', () => {
  it('count 0 is silent', async () => {
    const rule = new FeesOverdueRisingRule(ds([{ count: 0, students: 0, amount: '0' }]) as never);
    expect(await rule.evaluate(ctx())).toEqual([]);
  });

  it('fires one standing item with rounded amount', async () => {
    const rule = new FeesOverdueRisingRule(
      ds([{ count: 3, students: 2, amount: '1500.50' }]) as never,
    );
    const [f] = await rule.evaluate(ctx());
    expect(f.dedupeKey).toBe('school:t1');
    expect(f.params).toEqual({ count: 3, students: 2, amount: 1501 });
    expect(f.recipients).toEqual([ACCOUNTANT]);
  });

  it('uses the Dhaka local date across midnight UTC', async () => {
    // 18:00Z on the 9th is already the 10th in Dhaka.
    const d = ds([{ count: 1, students: 1, amount: '10' }]);
    await new FeesOverdueRisingRule(d as never).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10' }),
    );
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2026-10-03', '2026-10-10']);
  });
});

describe('FeesRemindersPendingRule', () => {
  it('silent at 0, fires with students otherwise, 7-day window from now', async () => {
    expect(
      await new FeesRemindersPendingRule(ds([{ students: 0 }]) as never).evaluate(ctx()),
    ).toEqual([]);
    const d = ds([{ students: 4 }]);
    const [f] = await new FeesRemindersPendingRule(d as never).evaluate(ctx());
    expect(f.params).toEqual({ students: 4 });
    expect(f.dedupeKey).toBe('school:t1');
    expect(d.query.mock.calls[0][1][2]).toEqual(new Date('2026-10-03T04:00:00Z'));
  });
});

describe('FeesUnassignedStudentsRule', () => {
  it('needs generation to have happened and someone missing', async () => {
    const none = new FeesUnassignedStudentsRule(ds([{ generated: 0, missing: 5 }]) as never);
    expect(await none.evaluate(ctx())).toEqual([]);
    const all = new FeesUnassignedStudentsRule(ds([{ generated: 5, missing: 0 }]) as never);
    expect(await all.evaluate(ctx())).toEqual([]);
  });

  it('keys per month and passes year/month from the local date', async () => {
    const d = ds([{ generated: 2, missing: 1 }]);
    const [f] = await new FeesUnassignedStudentsRule(d as never).evaluate(
      ctx({ localDate: '2026-01-01' }),
    );
    expect(f.dedupeKey).toBe('school:t1:2026-01');
    expect(f.params).toEqual({ missing: 1, month: '2026-01' });
    expect(d.query.mock.calls[0][1]).toEqual(['t1', 2026, 1]);
  });
});

describe('FeesStructureMissingNewYearRule', () => {
  it('no row is silent; a row fires per academic year', async () => {
    expect(await new FeesStructureMissingNewYearRule(ds([]) as never).evaluate(ctx())).toEqual([]);
    const [f] = await new FeesStructureMissingNewYearRule(
      ds([{ id: 'y2', name: '2027', start_date: '2026-11-20' }]) as never,
    ).evaluate(ctx());
    expect(f.dedupeKey).toBe('academic_year:y2');
    expect(f.subject).toEqual({ type: 'academic_year', id: 'y2' });
    expect(f.params).toEqual({ year: '2027', startDate: '2026-11-20' });
  });

  it('looks 60 days ahead of the local date', async () => {
    const d = ds([]);
    await new FeesStructureMissingNewYearRule(d as never).evaluate(
      ctx({ localDate: '2026-11-02' }),
    );
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2027-01-01']);
  });
});
