import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext, RuleFinding } from '../rule.types';
import { ChildAbsentTodayRule } from './child-absent-today.rule';
import { ExamsTomorrowRule } from './exams-tomorrow.rule';
import { FeesDueSoonRule } from './fees-due-soon.rule';
import { FeesOverdueFamilyRule } from './fees-overdue-family.rule';
import { GuardianProfileIncompleteRule } from './guardian-profile-incomplete.rule';
import { ResultsPublishedRule } from './results-published.rule';
import { RoutineChangedTodayRule } from './routine-changed-today.rule';

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

const LABEL = { id: 's1', full_name: 'Rafi', section_id: 'sec1', section_label: 'Six-A' };
type Family = { studentId: string; userId: string; role: UserRole.PARENT | UserRole.STUDENT };
const PARENT: Family = { studentId: 's1', userId: 'p1', role: UserRole.PARENT };
const STUDENT: Family = { studentId: 's1', userId: 'st1', role: UserRole.STUDENT };

/** The label query returns the child; every other query returns `rows`. */
function setup(rows: unknown[], users: Family[] = [PARENT, STUDENT]) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) => (sql.includes('section_label') ? [LABEL] : rows));
  const family = { familyUsersForStudents: vi.fn().mockResolvedValue(users) };
  const resolve = { resolveTenantDay: vi.fn().mockResolvedValue([]) };
  return {
    ds: { query } as never,
    family: family as never,
    resolve: resolve as never,
    query,
    fam: family,
    res: resolve,
  };
}

const RESERVED = ['studentId', 'studentName', 'sectionId', 'sectionLabel'];
// `{subjects_en}` / `{subjects_bn}` are the same placeholder in two languages.
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].replace(/_(en|bn)$/, '')).sort();

describe('family rules: shared contract', () => {
  const s = setup([]);
  const rules = [
    ['child.absent_today', new ChildAbsentTodayRule(s.ds, s.family)],
    ['fees.due_soon', new FeesDueSoonRule(s.ds, s.family)],
    ['fees.overdue_family', new FeesOverdueFamilyRule(s.ds, s.family)],
    ['exams.tomorrow', new ExamsTomorrowRule(s.ds, s.family)],
    ['results.published', new ResultsPublishedRule(s.ds, s.family)],
    ['routine.changed_today', new RoutineChangedTodayRule(s.ds, s.family, s.resolve)],
    ['guardian.profile_incomplete', new GuardianProfileIncompleteRule(s.ds)],
  ] as const;

  for (const [key, rule] of rules) {
    it(`${key}: meta, matching bn/en placeholders, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key));
      const { en, bn } = rule.messages;
      const text = (m: typeof en) => m.title + m.why + m.steps.join();
      expect(placeholders(text(en))).toEqual(placeholders(text(bn)));
      expect(en.steps.length).toBeLessThanOrEqual(3);
      expect(bn.steps).toHaveLength(en.steps.length);
    });
  }

  /** Every placeholder is in the finding's params, and child findings carry the reserved keys. */
  const checkFinding = (rule: (typeof rules)[number][1], f: RuleFinding, child = true) => {
    const { en, bn } = rule.messages;
    for (const p of placeholders(en.title + en.why + bn.title + bn.why)) {
      const has = p in f.params || `${p}_en` in f.params;
      expect(has, `${rule.meta.key} param ${p}`).toBe(true);
    }
    if (child) {
      expect(f.subject).toEqual({ type: 'student', id: 's1' });
      for (const k of RESERVED) expect(f.params).toHaveProperty(k);
    }
  };

  it('every rule produces a finding whose params cover its messages', async () => {
    const make = {
      'child.absent_today': (x: ReturnType<typeof setup>) =>
        new ChildAbsentTodayRule(x.ds, x.family),
      'fees.due_soon': (x: ReturnType<typeof setup>) => new FeesDueSoonRule(x.ds, x.family),
      'fees.overdue_family': (x: ReturnType<typeof setup>) =>
        new FeesOverdueFamilyRule(x.ds, x.family),
      'exams.tomorrow': (x: ReturnType<typeof setup>) => new ExamsTomorrowRule(x.ds, x.family),
      'results.published': (x: ReturnType<typeof setup>) =>
        new ResultsPublishedRule(x.ds, x.family),
    } as const;
    const rowsFor: Record<string, unknown[]> = {
      'child.absent_today': [{ student_id: 's1' }],
      'fees.due_soon': [{ student_id: 's1', amount: '10', first_due: '2026-10-11' }],
      'fees.overdue_family': [{ student_id: 's1', amount: '10', first_due: '2026-10-01' }],
      'exams.tomorrow': [
        { student_id: 's1', subjects_en: 'Math', subjects_bn: 'গণিত', starts_at: '09:00' },
      ],
      'results.published': [
        { id: 'r1', student_id: 's1', published_at: new Date('2026-10-10T03:00:00Z'), exam: 'Mid' },
      ],
    };
    for (const [key, build] of Object.entries(make)) {
      const x = setup(rowsFor[key]);
      const rule = build(x);
      const [f] = await rule.evaluate(ctx());
      expect(f, key).toBeDefined();
      checkFinding(rule, f);
    }
  });
});

describe('ChildAbsentTodayRule', () => {
  it('absent child with no family login still yields a finding with no recipients (D29)', async () => {
    const x = setup([{ student_id: 's1' }], []);
    const [f] = await new ChildAbsentTodayRule(x.ds, x.family).evaluate(ctx());
    expect(f.recipients).toEqual([]);
    expect(f.dedupeKey).toBe('student:s1:2026-10-10');
  });

  it('STUDENT-only login: the PARENT-only rule drops the row but keeps the finding', async () => {
    const x = setup([{ student_id: 's1' }], [STUDENT]);
    const [f] = await new ChildAbsentTodayRule(x.ds, x.family).evaluate(ctx());
    expect(f.recipients).toEqual([]);
  });

  it('PARENT login: one PARENT recipient carrying the studentId', async () => {
    const x = setup([{ student_id: 's1' }]);
    const [f] = await new ChildAbsentTodayRule(x.ds, x.family).evaluate(ctx());
    expect(f.recipients).toEqual([{ userId: 'p1', role: UserRole.PARENT, studentId: 's1' }]);
    // One family lookup for the whole run, not one per child.
    expect(x.fam.familyUsersForStudents).toHaveBeenCalledTimes(1);
  });

  it('expires at the end of the Dhaka day; non-working day is silent', async () => {
    const x = setup([{ student_id: 's1' }]);
    const rule = new ChildAbsentTodayRule(x.ds, x.family);
    const [f] = await rule.evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10' }),
    );
    expect(f.dedupeKey.endsWith(':2026-10-10')).toBe(true);
    expect(f.expiresAt).toEqual(new Date('2026-10-10T18:00:00.000Z'));
    expect(await rule.evaluate(ctx({ isWorkingDay: false }))).toEqual([]);
  });
});

describe('fee rules', () => {
  it('due_soon: a child with no PARENT recipient is dropped (no SMS fallback)', async () => {
    const x = setup([{ student_id: 's1', amount: '500.4', first_due: '2026-10-12' }], [STUDENT]);
    expect(await new FeesDueSoonRule(x.ds, x.family).evaluate(ctx())).toEqual([]);
  });

  it('due_soon: window is today..+3 days; amount rounded', async () => {
    const x = setup([{ student_id: 's1', amount: '500.4', first_due: '2026-10-12' }]);
    const [f] = await new FeesDueSoonRule(x.ds, x.family).evaluate(ctx());
    expect(f.params).toMatchObject({ amount: 500, dueDate: '2026-10-12' });
    expect(f.dedupeKey).toBe('student:s1');
    expect(x.query.mock.calls[0][1]).toEqual(['t1', '2026-10-10', '2026-10-13']);
  });

  it('overdue_family: kept with zero recipients (D29)', async () => {
    const x = setup([{ student_id: 's1', amount: '900', first_due: '2026-09-01' }], []);
    const [f] = await new FeesOverdueFamilyRule(x.ds, x.family).evaluate(ctx());
    expect(f.recipients).toEqual([]);
    expect(f.params).toMatchObject({ amount: 900, oldestDue: '2026-09-01' });
  });

  it('student_fees reads are scoped through students.tenant_id', async () => {
    const x = setup([]);
    await new FeesOverdueFamilyRule(x.ds, x.family).evaluate(ctx());
    expect(x.query.mock.calls[0][0]).toContain('s.tenant_id = $1');
    expect(x.query.mock.calls[0][1][0]).toBe('t1');
  });
});

describe('ExamsTomorrowRule', () => {
  it('Dhaka-midnight edge: queries tomorrow in local time and expires at the first paper', async () => {
    const x = setup([
      { student_id: 's1', subjects_en: 'Math', subjects_bn: 'গণিত', starts_at: '09:00' },
    ]);
    const [f] = await new ExamsTomorrowRule(x.ds, x.family).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10' }),
    );
    expect(x.query.mock.calls[0][1]).toEqual(['t1', '2026-10-11']);
    expect(f.expiresAt).toEqual(new Date('2026-10-11T03:00:00.000Z'));
    expect(f.dedupeKey).toBe('student:s1:2026-10-11');
    // STUDENT and PARENT both receive it.
    expect(f.recipients.map((r) => r.role).sort()).toEqual([UserRole.PARENT, UserRole.STUDENT]);
  });
});

describe('ResultsPublishedRule', () => {
  it('expires 72 h after publishing and looks back 72 h', async () => {
    const published = new Date('2026-10-10T03:00:00Z');
    const x = setup([{ id: 'r1', student_id: 's1', published_at: published, exam: 'Mid' }]);
    const [f] = await new ResultsPublishedRule(x.ds, x.family).evaluate(ctx());
    expect(f.dedupeKey).toBe('result:r1');
    expect(f.expiresAt).toEqual(new Date('2026-10-13T03:00:00Z'));
    expect(x.query.mock.calls[0][1][1]).toEqual(new Date('2026-10-07T04:00:00Z'));
  });
});

describe('RoutineChangedTodayRule', () => {
  const slot = (section_id: string, o: { cancelled?: boolean; substituted?: boolean }) =>
    ({ section_id, cancelled: false, substituted: false, ...o }) as never;

  it('counts cancelled vs covered per section; untouched sections are silent', async () => {
    const x = setup([{ id: 's1', class_section_id: 'sec1' }]);
    x.res.resolveTenantDay = vi
      .fn()
      .mockResolvedValue([
        slot('sec1', { cancelled: true }),
        slot('sec1', { substituted: true }),
        slot('sec1', { substituted: true }),
        slot('sec2', {}),
      ]);
    const [f] = await new RoutineChangedTodayRule(x.ds, x.family, x.res).evaluate(ctx());
    expect(f.params).toMatchObject({ cancelled: 1, covered: 2 });
    expect(f.dedupeKey).toBe('student:s1:2026-10-10');
    // Only the changed section's students are queried.
    expect(x.query.mock.calls[0][1][1]).toEqual(['sec1']);
  });

  it('no changed slot returns nothing without querying students', async () => {
    const x = setup([]);
    x.res.resolveTenantDay = vi.fn().mockResolvedValue([slot('sec1', {})]);
    expect(await new RoutineChangedTodayRule(x.ds, x.family, x.res).evaluate(ctx())).toEqual([]);
    expect(x.query).not.toHaveBeenCalled();
  });
});

describe('GuardianProfileIncompleteRule', () => {
  const run = (row: object) =>
    new GuardianProfileIncompleteRule(
      setup([{ id: 'g1', user_id: 'u1', phone: '017', email: null, alternate_phone: null, ...row }])
        .ds,
    ).evaluate(ctx());

  it('lists what is missing in both languages', async () => {
    const [f] = await run({ phone: ' ' });
    expect(f.params).toEqual({
      missing_en: 'phone number, email or second phone',
      missing_bn: 'ফোন নম্বর, ইমেইল বা দ্বিতীয় ফোন নম্বর',
    });
    expect(f.subject).toEqual({ type: 'guardian', id: 'g1' });
    expect(f.dedupeKey).toBe('guardian:g1');
    expect(f.recipients).toEqual([{ userId: 'u1', role: UserRole.PARENT }]);
  });

  it('phone present, nothing else: only the second contact is missing', async () => {
    const [f] = await run({});
    expect(f.params.missing_en).toBe('email or second phone');
  });
});
