import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { GuardianContactMissingRule } from './guardian-contact-missing.rule';
import { RoutineNotPublishedRule } from './routine-not-published.rule';
import { RoutineSubjectNoTeacherRule } from './routine-subject-no-teacher.rule';
import { SectionNoClassTeacherRule } from './section-no-class-teacher.rule';

const ADMIN = { userId: 'u1', role: UserRole.ADMIN };

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

/** First query returns `rows`; the recipients query returns the ADMIN. */
function ds(rows: unknown[], recipients: unknown[] = [ADMIN]) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM user_tenants') ? recipients : rows,
    );
  return { query };
}

// `{state_en}` / `{state_bn}` are the same placeholder in two languages.
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].replace(/_(en|bn)$/, '')).sort();

describe('structure rules: shared contract', () => {
  const rules = [
    ['routine.not_published', new RoutineNotPublishedRule(ds([]) as never)],
    ['section.no_class_teacher', new SectionNoClassTeacherRule(ds([]) as never)],
    ['routine.subject_no_teacher', new RoutineSubjectNoTeacherRule(ds([]) as never)],
    ['guardian.contact_missing', new GuardianContactMissingRule(ds([]) as never)],
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

describe('RoutineNotPublishedRule', () => {
  const run = (rows: unknown[]) => new RoutineNotPublishedRule(ds(rows) as never).evaluate(ctx());

  it.each([
    [null, 'not started', 'শুরু হয়নি'],
    ['DRAFT', 'draft', 'খসড়া'],
    ['REVIEW', 'waiting for review', 'পর্যালোচনার অপেক্ষায়'],
  ])('state %s fires with the matching labels', async (state, en, bn) => {
    const [f] = await run([{ id: 'y1', name: '2026', state }]);
    expect(f.params).toEqual({ year: '2026', state_en: en, state_bn: bn });
    expect(f.dedupeKey).toBe('academic_year:y1');
    expect(f.recipients).toEqual([ADMIN]);
  });

  it('PUBLISHED, or no current year with classes, is silent', async () => {
    expect(await run([{ id: 'y1', name: '2026', state: 'PUBLISHED' }])).toEqual([]);
    expect(await run([])).toEqual([]);
  });

  it('scopes the query to the tenant', async () => {
    const d = ds([{ id: 'y1', name: '2026', state: 'DRAFT' }]);
    await new RoutineNotPublishedRule(d as never).evaluate(ctx());
    expect(d.query.mock.calls.every((c) => c[1][0] === 't1')).toBe(true);
  });
});

describe('SectionNoClassTeacherRule', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `L${i}` }));
  const run = (n: number) => new SectionNoClassTeacherRule(ds(rows(n)) as never).evaluate(ctx());

  it('5 sections: count 5 and the first three labels plus an ellipsis', async () => {
    const [f] = await run(5);
    expect(f.params).toEqual({ count: 5, sections: 'L0, L1, L2 …' });
    expect(f.dedupeKey).toBe('school:t1');
  });

  it('2 sections: no ellipsis; 0 sections: silent', async () => {
    expect((await run(2))[0].params).toEqual({ count: 2, sections: 'L0, L1' });
    expect(await run(0)).toEqual([]);
  });

  it('no ADMIN recipient: nothing to raise', async () => {
    const rule = new SectionNoClassTeacherRule(ds(rows(1), []) as never);
    expect(await rule.evaluate(ctx())).toEqual([]);
  });
});

describe('RoutineSubjectNoTeacherRule', () => {
  it('sends the tenant-local date (not the UTC date) to SQL', async () => {
    // 18:00Z on the 9th is already the 10th in Dhaka.
    const d = ds([{ n: 4 }]);
    const [f] = await new RoutineSubjectNoTeacherRule(d as never).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10' }),
    );
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2026-10-10']);
    expect(f.params).toEqual({ count: 4 });
  });

  it('zero periods without a teacher is silent', async () => {
    expect(await new RoutineSubjectNoTeacherRule(ds([{ n: 0 }]) as never).evaluate(ctx())).toEqual(
      [],
    );
  });
});

describe('GuardianContactMissingRule', () => {
  it('fires with the student count, silent at zero', async () => {
    const [f] = await new GuardianContactMissingRule(ds([{ n: 7 }]) as never).evaluate(ctx());
    expect(f.params).toEqual({ count: 7 });
    expect(await new GuardianContactMissingRule(ds([{ n: 0 }]) as never).evaluate(ctx())).toEqual(
      [],
    );
  });
});
