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
    const fee = { id: 'f', total: 100, paid: 40, discount: 10 };
    const alloc = {
      student_fee_id: 'f',
      allocated: 40,
      discount: 10,
      status: 'SUCCESS',
      deleted: false,
    };
    const ok = { 'money-fees': [fee], 'money-allocations': [alloc] };
    expect(await checksOf(ok)).not.toContain('money');
    expect(await checksOf({ ...ok, 'money-allocations': [{ ...alloc, allocated: 30 }] })).toContain(
      'money',
    );
    expect(
      await checksOf({
        'money-fees': [{ ...fee, paid: 95 }],
        'money-allocations': [{ ...alloc, allocated: 95 }],
      }),
    ).toContain('money');
    expect(await checksOf({ ...ok, 'money-allocations': [{ ...alloc, discount: 20 }] })).toContain(
      'money',
    );
    expect(await checksOf({ 'money-invoice': [{ id: 'p' }] })).toContain('money');
  });

  it('money: a WAIVED bill must be settled (paid + discount = total)', async () => {
    const waived = { id: 'f', total: 100, paid: 0, discount: 100, status: 'WAIVED' };
    expect(await checksOf({ 'money-fees': [waived] })).not.toContain('money');
    expect(await checksOf({ 'money-fees': [{ ...waived, discount: 0 }] })).toContain('money');
  });

  // A reversal sets the original payment REFUNDED (its allocations stay) and adds a REFUNDED
  // mirror payment with positive allocations, while paid_amount and discount drop back.
  it('money: a reversed payment is healthy', async () => {
    const fee = { id: 'f', total: 100, paid: 0, discount: 0 };
    const alloc = {
      student_fee_id: 'f',
      allocated: 40,
      discount: 10,
      status: 'REFUNDED',
      deleted: false,
    };
    expect(
      await checksOf({ 'money-fees': [fee], 'money-allocations': [alloc, { ...alloc }] }),
    ).not.toContain('money');
  });

  // PENDING / FAILED payments and soft-deleted ones carry allocations that never moved paid_amount.
  it('money: ignores allocations of non-SUCCESS or deleted payments', async () => {
    const fee = { id: 'f', total: 100, paid: 0, discount: 0 };
    const alloc = {
      student_fee_id: 'f',
      allocated: 40,
      discount: 0,
      status: 'PENDING',
      deleted: false,
    };
    expect(
      await checksOf({
        'money-fees': [fee],
        'money-allocations': [alloc, { ...alloc, status: 'SUCCESS', deleted: true }],
      }),
    ).not.toContain('money');
  });

  // Fee generation pays a new bill from the wallet: a DEBIT_GENERATION row (stored negative),
  // no payment allocation. Undoing it adds a REVERSAL credit and drops paid_amount again.
  it('money: a wallet auto-paid bill, and its undo, are healthy', async () => {
    const fee = { id: 'f', total: 100, paid: 60, discount: 0 };
    const debit = { student_fee_id: 'f', kind: 'DEBIT_GENERATION', amount: -60 };
    expect(await checksOf({ 'money-fees': [fee], 'money-wallet': [debit] })).not.toContain('money');
    expect(
      await checksOf({
        'money-fees': [{ ...fee, paid: 0 }],
        'money-wallet': [debit, { student_fee_id: 'f', kind: 'REVERSAL', amount: 60 }],
      }),
    ).not.toContain('money');
    // checkout wallet use is already inside the payment's allocations, so it is not added again
    expect(
      await checksOf({
        'money-fees': [{ ...fee, paid: 0 }],
        'money-wallet': [{ student_fee_id: 'f', kind: 'DEBIT_CHECKOUT', amount: -60 }],
      }),
    ).not.toContain('money');
  });

  it('attendance: flags a session on a branch weekly off-day or a holiday only', async () => {
    // 2026-10-08 is a Thursday, 2026-10-09 a Friday, 2026-10-10 a Saturday
    const row = { date: '2026-10-08', slug: 'bmsc-high', settings: null, holiday: false };
    expect(await checksOf({ attendance: [row] })).not.toContain('attendance');
    expect(await checksOf({ attendance: [{ ...row, holiday: true }] })).toContain('attendance');
    // default policy: Friday off
    expect(await checksOf({ attendance: [{ ...row, date: '2026-10-09' }] })).toContain(
      'attendance',
    );
    expect(await checksOf({ attendance: [{ ...row, date: '2026-10-10' }] })).not.toContain(
      'attendance',
    );
    // a branch off on Friday and Saturday
    const friSat = { version: 1, attendance: { weeklyOffDays: [5, 6] } };
    expect(
      await checksOf({ attendance: [{ ...row, date: '2026-10-10', settings: friSat }] }),
    ).toContain('attendance');
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

  it('tenancy: flags an application acted on by a user from another branch', async () => {
    const stranger = {
      what: 'application decider',
      record_id: 'app-1',
      user_id: 'u-high-office',
      slug: 'bmsc-primary',
    };
    expect(await checksOf({ tenancy: [stranger] })).toContain('tenancy');
    expect(await checksOf({ tenancy: [] })).not.toContain('tenancy');
  });
});
