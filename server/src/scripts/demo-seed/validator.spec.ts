import { describe, expect, it } from 'vitest';
import { SlotRecurrence } from '@biddaloy/shared';
import { DEMO_CARDS } from '../../modules/demo/demo-accounts';
import { validate } from './validator';

/** Answers each validator query by its `/* check:<name> *\/` marker; unlisted checks return no rows. */
const fakeDb = (answers: Record<string, any[]>) => ({
  query: async (sql: string) => answers[/check:([\w-]+)/.exec(sql)![1]] ?? [],
});

const allLogins = DEMO_CARDS.map((c) => ({ email: c.email, slug: c.branchSlug }));
const school = { email: null, slug: 'bmsc-high' }; // a demo branch exists
const healthy = { logins: [...allLogins, school] };
const checksOf = async (answers: Record<string, any[]>) =>
  (await validate(fakeDb({ ...healthy, ...answers }))).map((v) => v.check);

const slot = (id: string, weekday: number) => ({
  id,
  section_id: id,
  period_slot_id: 'p1',
  weekday,
  subject_id: 's1',
  room_id: null,
  recurrence: SlotRecurrence.WEEKLY,
  recurrence_offset: 0,
  valid_from: '2026-01-01',
  valid_to: null,
  starts_at: '09:00:00',
  ends_at: '09:40:00',
  sequence: 1,
  kind: 'CLASS',
  user_id: 'teacher-1',
  slug: 'bmsc-high',
});

describe('demo seed validator', () => {
  it('passes a healthy database', async () => {
    expect(await validate(fakeDb(healthy))).toEqual([]);
  });

  it('routine: flags one teacher in two places at once, not on different days', async () => {
    expect(await checksOf({ routine: [slot('a', 1), slot('b', 1)] })).toContain('routine');
    expect(await checksOf({ routine: [slot('a', 1), slot('b', 2)] })).not.toContain('routine');
  });

  it('academic year: flags a branch without exactly one current year', async () => {
    expect(await checksOf({ 'academic-year': [{ slug: 'bmsc-high', n: 2 }] })).toContain(
      'academic-year',
    );
  });

  it('money: flags paid <> allocations, overpaid fees and invoice-less payments', async () => {
    const fee = { id: 'f', total: 100, paid: 40, discount: 10, allocated: 40 };
    expect(await checksOf({ 'money-fees': [fee] })).not.toContain('money');
    expect(await checksOf({ 'money-fees': [{ ...fee, allocated: 30 }] })).toContain('money');
    expect(await checksOf({ 'money-fees': [{ ...fee, paid: 95, allocated: 95 }] })).toContain(
      'money',
    );
    expect(await checksOf({ 'money-invoice': [{ id: 'p' }] })).toContain('money');
  });

  it('attendance: flags a session on an off-day or a holiday only', async () => {
    const row = { date: '2026-10-09', slug: 'bmsc-high', off_day: false, holiday: false };
    expect(await checksOf({ attendance: [row] })).not.toContain('attendance');
    expect(await checksOf({ attendance: [{ ...row, off_day: true }] })).toContain('attendance');
    expect(await checksOf({ attendance: [{ ...row, holiday: true }] })).toContain('attendance');
  });

  it('enrollment: flags a student with two ACTIVE enrollments in a year', async () => {
    expect(
      await checksOf({ enrollment: [{ student_id: 's', academic_year_id: 'y', n: 2 }] }),
    ).toContain('enrollment');
  });

  it('logins: flags a demo card with no membership in its branch', async () => {
    expect(await checksOf({ logins: [school, ...allLogins.slice(1)] })).toContain('logins');
    // before the org slice lands there are no branches, so there is nothing to check
    expect(await checksOf({ logins: [] })).not.toContain('logins');
  });
});
