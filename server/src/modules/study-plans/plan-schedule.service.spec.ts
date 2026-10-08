import { describe, it, expect } from 'vitest';
import type { StudyPlanLesson } from '@biddaloy/shared';
import type { ResolvedSlot } from '../routines/dto/resolve.dto';
import { mapLessonsToPeriods, type DeliveryInput } from './plan-schedule.service';

/**
 * [66.2.02/#2007] The pure mapping, one case per `it`. Math is "M"; P1 and P2
 * are two period slots of the same day. Today is Wed 2026-10-15.
 */
const SUBJECT = 'M';
const OTHER = 'X';
const TODAY = '2026-10-15';
const END = '2026-12-31';
const SEQ = new Map([
  ['P1', 1],
  ['P2', 2],
]);

const occ = (date: string, slot = 'P1', over: Partial<ResolvedSlot> = {}): ResolvedSlot =>
  ({
    date,
    period_slot_id: slot,
    routine_slot_id: `rs-${slot}`,
    subject_id: SUBJECT,
    cancelled: false,
    substituted: false,
    ...over,
  }) as ResolvedSlot;

const del = (
  date: string,
  status: DeliveryInput['status'],
  over: Partial<DeliveryInput> = {},
  slot = 'P1',
): DeliveryInput => ({
  date,
  period_slot_id: slot,
  subject_id: SUBJECT,
  status,
  reason: null,
  is_extra: false,
  ...over,
});
const notTaught = (date: string, reason: string, slot = 'P1') =>
  del(date, 'NOT_TAUGHT', { reason: reason as DeliveryInput['reason'] }, slot);

const L = (id: string, periods: number): StudyPlanLesson => ({ id, title: id, periods });
const run = (
  lessons: StudyPlanLesson[],
  occurrences: ResolvedSlot[],
  deliveries: DeliveryInput[] = [],
  over: { today?: string; rangeEnd?: string } = {},
) =>
  mapLessonsToPeriods({
    lessons,
    subjectId: SUBJECT,
    occurrences,
    deliveries,
    periodSequence: SEQ,
    today: over.today ?? TODAY,
    rangeEnd: over.rangeEnd ?? END,
  });
const lesson = (r: ReturnType<typeof run>, id: string) => r.lessons.find((l) => l.id === id)!;

describe('mapLessonsToPeriods', () => {
  it('worked example: 3 periods behind, today is L1 second period, then L2, L3', () => {
    // Holiday Wed 08 is simply absent from the occurrences (the resolver omits it).
    const r = run(
      [L('L1', 2), L('L2', 1), L('L3', 1)],
      [
        '2026-10-04',
        '2026-10-06',
        '2026-10-11',
        '2026-10-13',
        '2026-10-15',
        '2026-10-18',
        '2026-10-20',
      ].map((d) => occ(d)),
      [
        del('2026-10-04', 'TAUGHT'),
        del('2026-10-06', 'PARTLY'),
        notTaught('2026-10-11', 'TEACHER_ABSENT'),
      ],
    );
    expect(r.owed_by_today).toBe(4);
    expect(r.taught).toBe(1);
    expect(r.periods_behind).toBe(3);
    expect(lesson(r, 'L1')).toMatchObject({ taught_periods: 1, status: 'IN_PROGRESS' });
    expect(lesson(r, 'L1').expected_end_date).toBe('2026-10-15');
    expect(lesson(r, 'L2').expected_date).toBe('2026-10-18');
    expect(lesson(r, 'L3').expected_date).toBe('2026-10-20');
    expect(r.unreported).toEqual({ periods: 1, school_days: 1, oldest_date: '2026-10-13' });
  });

  it('holiday: no occurrence means no period, nothing owed, lessons shift to the next occurrence', () => {
    const r = run([L('L1', 1), L('L2', 1)], [occ('2026-10-20'), occ('2026-10-22')]);
    expect(r.periods).toHaveLength(2);
    expect(r.owed_by_today).toBe(0);
    expect(lesson(r, 'L1').expected_date).toBe('2026-10-20');
    expect(lesson(r, 'L2').expected_date).toBe('2026-10-22');
  });

  it('cancelled period: occurrence cancelled is EXCLUDED, not owed, lesson not consumed', () => {
    const r = run([L('L1', 1)], [occ('2026-10-11', 'P1', { cancelled: true }), occ('2026-10-20')]);
    expect(r.periods[0]).toMatchObject({ status: 'EXCLUDED' });
    expect(r.owed_by_today).toBe(0);
    expect(lesson(r, 'L1').expected_date).toBe('2026-10-20');
  });

  it.each(['CANCELLED', 'SCHOOL_CLOSED'])('NOT_TAUGHT %s is EXCLUDED and not owed', (reason) => {
    const r = run(
      [L('L1', 1)],
      [occ('2026-10-11'), occ('2026-10-20')],
      [notTaught('2026-10-11', reason)],
    );
    expect(r.periods[0]).toMatchObject({ status: 'EXCLUDED', reason });
    expect(r.owed_by_today).toBe(0);
    expect(r.periods_behind).toBe(0);
    expect(lesson(r, 'L1').expected_date).toBe('2026-10-20');
  });

  it('exam (D39): EXAM is excluded, same behind count as if the period did not exist', () => {
    const withExam = run(
      [L('L1', 1)],
      [occ('2026-10-11'), occ('2026-10-13')],
      [notTaught('2026-10-11', 'EXAM'), del('2026-10-13', 'TAUGHT')],
    );
    const without = run([L('L1', 1)], [occ('2026-10-13')], [del('2026-10-13', 'TAUGHT')]);
    expect(withExam.periods_behind).toBe(without.periods_behind);
    expect(withExam.periods[0].status).toBe('EXCLUDED');
  });

  it.each(['TEACHER_ABSENT', 'ON_LEAVE', 'OTHER'])(
    'NOT_TAUGHT %s is owed: behind +1, lesson not consumed',
    (reason) => {
      const r = run([L('L1', 1)], [occ('2026-10-11')], [notTaught('2026-10-11', reason)]);
      expect(r.periods[0]).toMatchObject({ status: 'NOT_TAUGHT', reason });
      expect(r.owed_by_today).toBe(1);
      expect(r.periods_behind).toBe(1);
      expect(lesson(r, 'L1').taught_periods).toBe(0);
    },
  );

  it('capacity with exclusions (D39): two marked-ahead periods are not left; a past absence does not change periods_left', () => {
    const days = [
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ];
    const base = run(
      [L('L1', 20)],
      days.map((d) => occ(d)),
      [notTaught('2026-10-21', 'EXAM'), notTaught('2026-10-22', 'SCHOOL_CLOSED')],
    );
    expect(base.capacity.periods_left).toBe(8);
    const withPast = run(
      [L('L1', 20)],
      [occ('2026-10-11'), ...days.map((d) => occ(d))],
      [
        notTaught('2026-10-21', 'EXAM'),
        notTaught('2026-10-22', 'SCHOOL_CLOSED'),
        notTaught('2026-10-11', 'TEACHER_ABSENT'),
      ],
    );
    expect(withPast.capacity.periods_left).toBe(8);
    expect(withPast.owed_by_today).toBe(1);
  });

  it('teacher leave: auto NOT_TAUGHT ON_LEAVE is owed and not consumed (behind grows)', () => {
    const r = run(
      [L('L1', 1)],
      [occ('2026-10-11'), occ('2026-10-13')],
      [notTaught('2026-10-11', 'ON_LEAVE'), notTaught('2026-10-13', 'ON_LEAVE')],
    );
    expect(r.periods_behind).toBe(2);
    expect(lesson(r, 'L1').status).toBe('UPCOMING');
  });

  it('double class: a 2-period lesson can finish on one day', () => {
    const r = run([L('L1', 2)], [occ('2026-10-20', 'P1'), occ('2026-10-20', 'P2')]);
    expect(lesson(r, 'L1')).toMatchObject({
      expected_date: '2026-10-20',
      expected_end_date: '2026-10-20',
      overflow: false,
    });
  });

  it('double class: two 1-period lessons both get that day', () => {
    const r = run([L('L1', 1), L('L2', 1)], [occ('2026-10-20', 'P1'), occ('2026-10-20', 'P2')]);
    expect(lesson(r, 'L1').expected_date).toBe('2026-10-20');
    expect(lesson(r, 'L2').expected_date).toBe('2026-10-20');
  });

  it('extra class (D40): an is_extra TAUGHT row on a free period consumes one period, owed unchanged', () => {
    const r = run(
      [L('L1', 2)],
      [occ('2026-10-11')],
      [del('2026-10-11', 'TAUGHT'), del('2026-10-12', 'TAUGHT', { is_extra: true }, 'P2')],
    );
    const extra = r.periods.find((p) => p.date === '2026-10-12')!;
    expect(extra).toMatchObject({ kind: 'EXTRA', status: 'TAUGHT', lesson_id: 'L1' });
    expect(lesson(r, 'L1')).toMatchObject({
      in_extra_class: true,
      status: 'DONE',
      taught_periods: 2,
    });
    expect(r.owed_by_today).toBe(1);
    expect(r.taught).toBe(2);
    expect(r.periods_behind).toBe(-1);
  });

  it("extra class (D40): another subject's extra in this slot excludes the occurrence", () => {
    const r = run(
      [L('L1', 1)],
      [occ('2026-10-20')],
      [del('2026-10-20', 'TAUGHT', { subject_id: OTHER, is_extra: true })],
    );
    expect(r.periods[0]).toMatchObject({ status: 'EXCLUDED' });
    expect(lesson(r, 'L1').expected_date).toBeNull();
  });

  it('partly: PARTLY then TAUGHT on a 1-period lesson finishes it on the second period', () => {
    const r = run(
      [L('L1', 1)],
      [occ('2026-10-11'), occ('2026-10-13')],
      [del('2026-10-11', 'PARTLY'), del('2026-10-13', 'TAUGHT')],
    );
    expect(lesson(r, 'L1')).toMatchObject({ status: 'DONE', taught_periods: 1 });
    expect(r.owed_by_today).toBe(2);
    expect(r.taught).toBe(1);
  });

  it('term boundary: lessons needing more periods than remain overflow; capacity does not fit', () => {
    const r = run([L('L1', 1), L('L2', 1), L('L3', 1)], [occ('2026-10-20'), occ('2026-10-22')]);
    expect(lesson(r, 'L3')).toMatchObject({ overflow: true, expected_date: null });
    expect(lesson(r, 'L2').overflow).toBe(false);
    expect(r.capacity).toEqual({ periods_left: 2, periods_needed: 3, fits: false });
  });

  it('term boundary: periods after rangeEnd are ignored even if passed in', () => {
    const r = run([L('L1', 1)], [occ('2026-10-20'), occ('2027-01-05')], [], {
      rangeEnd: '2026-12-31',
    });
    expect(r.periods).toHaveLength(1);
  });

  it('routine edited mid-term: a delivery under the old slot still counts, no gap, no double count', () => {
    // Same period slot P1, two routine slots (old ended 10-12, new started 10-13).
    const r = run(
      [L('L1', 2)],
      [
        occ('2026-10-11', 'P1', { routine_slot_id: 'old' }),
        occ('2026-10-13', 'P1', { routine_slot_id: 'new' }),
      ],
      [del('2026-10-11', 'TAUGHT'), del('2026-10-13', 'TAUGHT')],
    );
    expect(r.periods).toHaveLength(2);
    expect(r.taught).toBe(2);
    expect(r.owed_by_today).toBe(2);
    expect(lesson(r, 'L1').status).toBe('DONE');
  });

  it('unreported: a past occurrence with no row is UNREPORTED and owed; two on one date are 1 school day', () => {
    const r = run([L('L1', 5)], [occ('2026-10-11', 'P1'), occ('2026-10-11', 'P2')]);
    expect(r.periods.map((p) => p.status)).toEqual(['UNREPORTED', 'UNREPORTED']);
    expect(r.owed_by_today).toBe(2);
    expect(r.unreported).toEqual({ periods: 2, school_days: 1, oldest_date: '2026-10-11' });
  });

  it('today: an unmarked period today is FUTURE; with a TAUGHT row it is taught but not owed', () => {
    const open = run([L('L1', 1)], [occ(TODAY)]);
    expect(open.periods[0].status).toBe('FUTURE');
    expect(open.unreported.periods).toBe(0);
    const done = run([L('L1', 1)], [occ(TODAY)], [del(TODAY, 'TAUGHT')]);
    expect(done.taught).toBe(1);
    expect(done.owed_by_today).toBe(0);
  });

  it('ahead: more taught (extras) than owed gives negative periods_behind and zero lessons_behind', () => {
    const r = run(
      [L('L1', 1), L('L2', 1)],
      [],
      [
        del('2026-10-11', 'TAUGHT', { is_extra: true }),
        del('2026-10-12', 'TAUGHT', { is_extra: true }),
      ],
    );
    expect(r.periods_behind).toBe(-2);
    expect(r.lessons_behind).toBe(0);
  });

  it('empty plan: zero counts and it fits', () => {
    const r = run([], [occ('2026-10-20')]);
    expect(r).toMatchObject({ lessons_total: 0, lessons_done: 0, periods_behind: 0 });
    expect(r.capacity.fits).toBe(true);
  });

  it('no occurrences at all: every lesson overflows and periods_left is 0', () => {
    const r = run([L('L1', 1), L('L2', 1)], []);
    expect(r.lessons.every((l) => l.overflow && l.expected_date === null)).toBe(true);
    expect(r.capacity).toEqual({ periods_left: 0, periods_needed: 2, fits: false });
  });
});
