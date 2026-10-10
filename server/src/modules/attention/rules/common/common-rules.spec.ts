import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { CalendarHolidayTomorrowRule } from './calendar-holiday-tomorrow.rule';
import { SurveysPendingRule } from './surveys-pending.rule';

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T14:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '20:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
  ...extra,
});

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Recipients query echoes the roles it was asked for, one user per role. */
function holidayDs(events: unknown[]) {
  const query = vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM user_tenants')) {
      return (params[1] as string[]).map((role) => ({ userId: `u-${role}`, role }));
    }
    return events;
  });
  return { query };
}

describe('common rules: shared contract', () => {
  const rules = [
    ['calendar.holiday_tomorrow', new CalendarHolidayTomorrowRule(holidayDs([]) as never)],
    ['surveys.pending', new SurveysPendingRule({ query: vi.fn() } as never, {} as never)],
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

describe('CalendarHolidayTomorrowRule', () => {
  const event = (audience: string) => ({ id: 'h1', name: 'Eid', audience, end_date: '2026-10-13' });
  const run = (audience: string) =>
    new CalendarHolidayTomorrowRule(holidayDs([event(audience)]) as never).evaluate(ctx());

  it('STAFF audience: only the staff finding, and never PARENT, STUDENT or SUPER_ADMIN', async () => {
    const found = await run('STAFF');
    expect(found.map((f) => f.dedupeKey)).toEqual(['calendar_event:h1:2026-10-11:staff']);
    const roles = found[0].recipients.map((r) => r.role);
    expect(roles).not.toContain(UserRole.PARENT);
    expect(roles).not.toContain(UserRole.STUDENT);
    expect(roles).not.toContain(UserRole.SUPER_ADMIN);
    expect(roles).toContain(UserRole.TEACHER);
  });

  it('ALL audience: staff finding plus a family finding for PARENT + STUDENT', async () => {
    const found = await run('ALL');
    expect(found.map((f) => f.actionUrl)).toEqual(['/calendar', '/portal/calendar']);
    expect(found[1].recipients.map((r) => r.role)).toEqual([UserRole.PARENT, UserRole.STUDENT]);
    expect(found[1].params).toEqual({ name: 'Eid', until: '2026-10-13' });
  });

  it('local-midnight edge: asks for the tenant-local tomorrow and expires at Dhaka midnight', async () => {
    // 18:00Z on New Year's Eve is already 2027-01-01 in Dhaka.
    const d = holidayDs([event('STAFF')]);
    const [f] = await new CalendarHolidayTomorrowRule(d as never).evaluate(
      ctx({ now: new Date('2026-12-31T18:00:00Z'), localDate: '2027-01-01' }),
    );
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2027-01-02', true]);
    expect(f.expiresAt?.toISOString()).toBe('2027-01-01T18:00:00.000Z');
  });

  it('no holiday: silent after a single query', async () => {
    const d = holidayDs([]);
    expect(await new CalendarHolidayTomorrowRule(d as never).evaluate(ctx())).toEqual([]);
    expect(d.query).toHaveBeenCalledTimes(1);
  });
});

describe('SurveysPendingRule', () => {
  const survey = (respondent = 'BOTH') => ({
    id: 'sv1',
    title: 'Teachers',
    respondent,
    closes_at: null,
  });
  const pair = (student_id: string, teacher_id = 'T1', subject_id = 'M') => ({
    survey_id: 'sv1',
    teacher_id,
    subject_id,
    student_id,
  });

  function build(opts: {
    surveys: unknown[];
    eligible?: unknown[];
    users?: unknown[];
    done?: unknown[];
  }) {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM surveys')) return opts.surveys;
      if (sql.includes('FROM survey_targets')) return opts.eligible ?? [];
      return opts.done ?? [];
    });
    const family = { familyUsersForStudents: vi.fn().mockResolvedValue(opts.users ?? []) };
    return { rule: new SurveysPendingRule({ query } as never, family as never), query, family };
  }

  const parent = (studentId: string) => ({ studentId, userId: 'p1', role: UserRole.PARENT });
  const student = (studentId: string) => ({ studentId, userId: 'st1', role: UserRole.STUDENT });

  it('respondent GUARDIANS drops the STUDENT rows', async () => {
    const { rule } = build({
      surveys: [survey('GUARDIANS')],
      eligible: [pair('s1')],
      users: [parent('s1'), student('s1')],
    });
    const found = await rule.evaluate(ctx());
    expect(found.map((f) => f.recipients[0].userId)).toEqual(['p1']);
  });

  it('a pair the user already answered is not counted', async () => {
    const { rule } = build({
      surveys: [survey()],
      eligible: [pair('s1', 'T1'), pair('s1', 'T2')],
      users: [parent('s1')],
      done: [{ survey_id: 'sv1', respondent_user_id: 'p1', teacher_id: 'T1', subject_id: 'M' }],
    });
    const [f] = await rule.evaluate(ctx());
    expect(f.params).toEqual({ title: 'Teachers', count: 1 });
    expect(f.dedupeKey).toBe('survey:sv1:user:p1');
  });

  it('everything answered: silent', async () => {
    const { rule } = build({
      surveys: [survey()],
      eligible: [pair('s1')],
      users: [parent('s1')],
      done: [{ survey_id: 'sv1', respondent_user_id: 'p1', teacher_id: 'T1', subject_id: 'M' }],
    });
    expect(await rule.evaluate(ctx())).toEqual([]);
  });

  it('a parent with two children in the same section counts each pair once', async () => {
    const { rule } = build({
      surveys: [survey()],
      eligible: [pair('s1'), pair('s2')],
      users: [parent('s1'), parent('s2')],
    });
    const found = await rule.evaluate(ctx());
    expect(found).toHaveLength(1);
    expect(found[0].params.count).toBe(1);
  });

  it('no open survey: [] and only one query', async () => {
    const { rule, query, family } = build({ surveys: [] });
    expect(await rule.evaluate(ctx())).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(family.familyUsersForStudents).not.toHaveBeenCalled();
  });

  it('scopes every query to the tenant', async () => {
    const { rule, query } = build({
      surveys: [survey()],
      eligible: [pair('s1')],
      users: [parent('s1')],
    });
    await rule.evaluate(ctx());
    expect(query.mock.calls.every((c) => c[1][0] === 't1')).toBe(true);
  });
});
