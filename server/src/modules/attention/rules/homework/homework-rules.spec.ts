import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { localDateTimeToUtc } from '../rule-context.service';
import type { AttentionRule, RuleContext } from '../rule.types';
import { HomeworkDueTodayRule } from './homework-due-today.rule';
import { HomeworkDueTomorrowRule } from './homework-due-tomorrow.rule';
import { HomeworkNotSubmittedRule } from './homework-not-submitted.rule';
import { HomeworkToGradeRule } from './homework-to-grade.rule';

const SEC = 'sec-7b';
const MATH = 'math';
const row = (studentId: string, extra = {}) => ({
  assignmentId: 'as1',
  homeworkId: 'hw1',
  title: 'Ch 3',
  subjectId: MATH,
  subject_en: 'Math',
  subject_bn: 'গণিত',
  sectionId: SEC,
  sectionLabel: '7-B',
  studentId,
  studentName: `Kid ${studentId}`,
  createdAt: new Date('2026-10-09T03:00:00Z'),
  ...extra,
});
const PARENT = (s: string) => ({ studentId: s, userId: `p-${s}`, role: UserRole.PARENT });
const STUDENT = (s: string) => ({ studentId: s, userId: `u-${s}`, role: UserRole.STUDENT });

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T08:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
  ...extra,
});

interface Fixture {
  notSubmitted?: unknown[];
  periods?: unknown[];
  teachers?: unknown[];
  toGrade?: unknown[];
  slots?: unknown[];
  family?: unknown[];
}
function fixture(f: Fixture = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM homework_assignments ha') && sql.includes('UNION ALL'))
      return f.notSubmitted ?? [];
    if (sql.includes('FROM period_slots')) return f.periods ?? [];
    if (sql.includes('teacher_class_sections')) return f.teachers ?? [];
    if (sql.includes('GROUP BY')) return f.toGrade ?? [];
    if (sql.includes('FROM class_sections cs')) return [{ id: SEC, label: '7-B' }];
    return [];
  });
  const resolveTenantDay = vi.fn(async () => f.slots ?? []);
  const familyUsersForStudents = vi.fn(async () => f.family ?? []);
  return {
    ds: { query },
    query,
    resolve: { resolveTenantDay },
    resolveTenantDay,
    family: { familyUsersForStudents },
    familyUsersForStudents,
  };
}
const mathSlot = (periodSlotId: string, cancelled = false) => ({
  section_id: SEC,
  subject_id: MATH,
  period_slot_id: periodSlotId,
  cancelled,
});
const periods = [
  { id: 'p1', start: '09:00', end: '09:40' },
  { id: 'p2', start: '10:00', end: '10:40' },
  { id: 'p3', start: '13:00', end: '13:30' },
];
const TEACHER_ROW = { sectionId: SEC, subjectId: MATH, userId: 'teacher-1' };
const notSubmitted = (f: ReturnType<typeof fixture>) =>
  new HomeworkNotSubmittedRule(f.ds as never, f.resolve as never, f.family as never);

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

describe('homework rules: shared contract', () => {
  const f = fixture();
  const rules: [string, AttentionRule][] = [
    ['homework.not_submitted', notSubmitted(f)],
    ['homework.due_today', new HomeworkDueTodayRule(f.ds as never, f.family as never)],
    ['homework.due_tomorrow', new HomeworkDueTomorrowRule(f.ds as never, f.family as never)],
    ['homework.to_grade', new HomeworkToGradeRule(f.ds as never)],
  ];
  for (const [key, rule] of rules) {
    it(`${key}: meta, bn/en placeholders match, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key as never));
      const { en, bn } = rule.messages;
      const strip = (s: string[]) => s.map((p) => p.replace(/_(en|bn)$/, '')).sort();
      const all = (m: typeof en) => [m.title, m.why, ...m.steps].join(' ');
      expect(strip(placeholders(all(en)))).toEqual(strip(placeholders(all(bn))));
      expect(en.steps.length).toBeLessThanOrEqual(3);
      expect(bn.steps).toHaveLength(en.steps.length);
    });
  }
});

describe('HomeworkNotSubmittedRule', () => {
  const base = (over: Partial<Fixture> = {}) =>
    fixture({
      notSubmitted: [row('s1'), row('s2')],
      periods,
      slots: [mathSlot('p2')],
      teachers: [TEACHER_ROW],
      family: [PARENT('s1'), STUDENT('s1'), PARENT('s2')],
      ...over,
    });

  it('is silent before the first Math period starts', async () => {
    expect(await notSubmitted(base()).evaluate(ctx({ localTime: '09:59' }))).toEqual([]);
  });

  it('at the Math period start: student+guardian findings and one teacher finding', async () => {
    const f = base();
    const findings = await notSubmitted(f).evaluate(ctx({ localTime: '10:00' }));
    const s1 = findings.find((x) => x.dedupeKey === 'student:s1:2026-10-10:as1')!;
    expect(s1.recipients.map((r) => r.userId).sort()).toEqual(['p-s1', 'u-s1']);
    expect(s1.subject).toEqual({ type: 'student', id: 's1' });
    expect(s1.params.headline_en).toBe('Kid s1 has not submitted the Math homework');
    expect(s1.expiresAt).toEqual(localDateTimeToUtc('2026-10-11', '00:00', 'Asia/Dhaka'));
    const teacher = findings.find((x) => x.dedupeKey === `section:${SEC}:2026-10-10:${MATH}`)!;
    expect(teacher.params.count).toBe(2);
    expect(teacher.recipients).toEqual([{ userId: 'teacher-1', role: UserRole.TEACHER }]);
    // One routine call and one family call for the whole run: no loops.
    expect(f.resolveTenantDay).toHaveBeenCalledTimes(1);
    expect(f.familyUsersForStudents).toHaveBeenCalledTimes(1);
  });

  it('a cancelled Math period does not set the trigger; the section last period end does', async () => {
    const f = base({ slots: [mathSlot('p1', true), { ...mathSlot('p2'), subject_id: 'art' }] });
    expect(await notSubmitted(f).evaluate(ctx({ localTime: '10:39' }))).toEqual([]);
    expect(await notSubmitted(f).evaluate(ctx({ localTime: '10:40' }))).not.toEqual([]);
  });

  // FAST sweeps stop at the school's last period end (13:30) and tick every 5 min,
  // so a trigger at 13:30 itself would usually be missed: it moves 10 min earlier.
  it('a section ending with the school fires 10 min before the last bell', async () => {
    const f = base({ slots: [mathSlot('p2', true), { ...mathSlot('p3'), subject_id: 'art' }] });
    expect(await notSubmitted(f).evaluate(ctx({ localTime: '13:19' }))).toEqual([]);
    expect(await notSubmitted(f).evaluate(ctx({ localTime: '13:20' }))).not.toEqual([]);
  });

  it('no routine at all: school last period end (less the margin), else 16:00', async () => {
    const noRoutine = base({ slots: [] });
    expect(await notSubmitted(noRoutine).evaluate(ctx({ localTime: '13:19' }))).toEqual([]);
    expect(await notSubmitted(noRoutine).evaluate(ctx({ localTime: '13:20' }))).not.toEqual([]);
    const nothing = base({ slots: [], periods: [] });
    expect(await notSubmitted(nothing).evaluate(ctx({ localTime: '15:59' }))).toEqual([]);
    expect(await notSubmitted(nothing).evaluate(ctx({ localTime: '16:00' }))).not.toEqual([]);
  });

  // An after-school recheck must not raise homework that was posted after its own trigger.
  it('homework posted after its trigger (10:00) is never raised, even at night', async () => {
    const late = { createdAt: localDateTimeToUtc('2026-10-10', '20:00', 'Asia/Dhaka') };
    const f = base({ notSubmitted: [row('s1', late), row('s2')] });
    const findings = await notSubmitted(f).evaluate(ctx({ localTime: '21:00' }));
    expect(findings.map((x) => x.dedupeKey)).not.toContain('student:s1:2026-10-10:as1');
    expect(findings.map((x) => x.dedupeKey)).toContain('student:s2:2026-10-10:as1');
    expect(
      await notSubmitted(base({ notSubmitted: [row('s1', late)] })).evaluate(
        ctx({ localTime: '21:00' }),
      ),
    ).toEqual([]);
  });

  it('non-working day: nothing', async () => {
    expect(await notSubmitted(base()).evaluate(ctx({ isWorkingDay: false }))).toEqual([]);
  });

  it('skips a student with no family user and a section with no subject teacher', async () => {
    const f = base({ family: [PARENT('s1')], teachers: [] });
    const findings = await notSubmitted(f).evaluate(ctx());
    expect(findings.map((x) => x.dedupeKey)).toEqual(['student:s1:2026-10-10:as1']);
  });

  it('local-midnight edge: the Dhaka date goes to SQL and the alert expires at Dhaka midnight', async () => {
    const f = base();
    const [first] = await notSubmitted(f).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10', localTime: '23:30' }),
    );
    const sqlCall = f.query.mock.calls.find((c) => String(c[0]).includes('UNION ALL'))!;
    expect((sqlCall as unknown as unknown[][])[1]).toEqual(['t1', '2026-10-10']);
    expect(first.expiresAt?.toISOString()).toBe('2026-10-10T18:00:00.000Z');
  });
});

describe('HomeworkDueTodayRule', () => {
  it('reaches students only, never guardians', async () => {
    const f = fixture({
      notSubmitted: [row('s1'), row('s1', { assignmentId: 'as2' })],
      family: [PARENT('s1'), STUDENT('s1')],
    });
    const [finding] = await new HomeworkDueTodayRule(f.ds as never, f.family as never).evaluate(
      ctx(),
    );
    expect(finding.recipients).toEqual([
      { userId: 'u-s1', role: UserRole.STUDENT, studentId: 's1' },
    ]);
    expect(finding.params.count).toBe(2);
    expect(finding.dedupeKey).toBe('student:s1:2026-10-10');
  });
});

describe('HomeworkDueTomorrowRule', () => {
  it('looks at the next day across a year boundary and expires at local midnight', async () => {
    const f = fixture({ notSubmitted: [row('s1')], family: [PARENT('s1'), STUDENT('s1')] });
    const [finding] = await new HomeworkDueTomorrowRule(f.ds as never, f.family as never).evaluate(
      ctx({ localDate: '2026-12-31' }),
    );
    const sqlCall = f.query.mock.calls.find((c) => String(c[0]).includes('UNION ALL'))!;
    expect((sqlCall as unknown as unknown[][])[1]).toEqual(['t1', '2027-01-01']);
    expect(finding.expiresAt).toEqual(localDateTimeToUtc('2027-01-01', '00:00', 'Asia/Dhaka'));
    expect(finding.recipients.map((r) => r.role).sort()).toEqual([
      UserRole.PARENT,
      UserRole.STUDENT,
    ]);
  });
});

describe('HomeworkToGradeRule', () => {
  it('one finding per section+subject with the count, deduped without a date', async () => {
    const f = fixture({
      toGrade: [
        { sectionId: SEC, subjectId: MATH, subject_en: 'Math', subject_bn: 'গণিত', count: 3 },
      ],
      teachers: [TEACHER_ROW],
    });
    const [finding] = await new HomeworkToGradeRule(f.ds as never).evaluate(ctx());
    expect(finding.params).toMatchObject({ count: 3, sectionLabel: '7-B' });
    expect(finding.dedupeKey).toBe(`section:${SEC}:${MATH}`);
  });
});
