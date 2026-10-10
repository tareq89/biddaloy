import { describe, it, expect, vi, beforeEach } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { AttentionRule, RuleContext } from '../rule.types';

const loadNotSubmitted = vi.fn();
vi.mock('../homework/homework-not-submitted.rule', () => ({
  loadNotSubmitted: (...a: unknown[]) => loadNotSubmitted(...a),
}));

import { ClassStartingRule } from './class-starting.rule';
import { RoutineSubstitutionTodayRule } from './routine-substitution-today.rule';
import { RoutineUncoveredPeriodsRule } from './routine-uncovered-periods.rule';

const SEC = 'sec-7b';
const MATH = 'math';
const slot = (extra: Record<string, unknown> = {}) => ({
  routine_slot_id: 'rs1',
  section_id: SEC,
  period_slot_id: 'p1',
  subject_id: MATH,
  subject_name_en: 'Math',
  subject_name_bn: 'গণিত',
  teacher_ids: ['T1'],
  substituted: false,
  cancelled: false,
  ...extra,
});
const PERIODS = [
  { id: 'p1', starts_at: '10:00', ends_at: '10:40' },
  { id: 'p2', starts_at: '08:00', ends_at: '08:40' },
  { id: 'p3', starts_at: '00:05', ends_at: '00:45' },
];

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T04:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: { classStartingLeadMinutes: 10 } as RuleContext['settings'],
  ...extra,
});

interface Fx {
  slots?: unknown[];
  teachers?: unknown[];
  leaves?: unknown[];
  admins?: unknown[];
}
function fixture(f: Fx = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM period_slots')) return PERIODS;
    if (sql.includes('FROM class_sections cs')) return [{ id: SEC, label: '7-B' }];
    if (sql.includes('FROM teachers t'))
      return (
        f.teachers ?? [
          { id: 'T1', user_id: 'u-T1', staff_profile_id: 'sp-T1' },
          { id: 'SUB', user_id: 'u-SUB', staff_profile_id: 'sp-SUB' },
        ]
      );
    if (sql.includes('FROM leave_records')) return f.leaves ?? [];
    if (sql.includes('FROM user_tenants'))
      return f.admins ?? [{ userId: 'exec', role: UserRole.EXECUTIVE }];
    return [];
  });
  const resolveTenantDay = vi.fn(async () => f.slots ?? [slot()]);
  return { ds: { query }, query, resolve: { resolveTenantDay }, resolveTenantDay };
}

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].replace(/_(en|bn)$/, '')).sort();

beforeEach(() => loadNotSubmitted.mockReset().mockResolvedValue([]));

describe('period rules: shared contract', () => {
  const f = fixture();
  const rules: [string, AttentionRule][] = [
    ['class.starting', new ClassStartingRule(f.ds as never, f.resolve as never)],
    [
      'routine.substitution_today',
      new RoutineSubstitutionTodayRule(f.ds as never, f.resolve as never),
    ],
    [
      'routine.uncovered_periods',
      new RoutineUncoveredPeriodsRule(f.ds as never, f.resolve as never),
    ],
  ];
  for (const [key, rule] of rules) {
    it(`${key}: meta, bn/en placeholders match, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key as never));
      const { en, bn } = rule.messages;
      const all = (m: typeof en) => [m.title, m.why, ...m.steps].join(' ');
      expect(placeholders(all(en))).toEqual(placeholders(all(bn)));
      expect(en.steps.length).toBeLessThanOrEqual(3);
    });
  }
});

describe('ClassStartingRule', () => {
  const run = (f: ReturnType<typeof fixture>, over: Partial<RuleContext> = {}) =>
    new ClassStartingRule(f.ds as never, f.resolve as never).evaluate(ctx(over));

  it('opens 10 minutes before the period and closes at its end', async () => {
    expect(await run(fixture(), { localTime: '09:49' })).toEqual([]);
    const [open] = await run(fixture(), { localTime: '09:50' });
    // 10:40 Dhaka = 04:40Z; the reminder is gone when the period ends (D19).
    expect(open.expiresAt?.toISOString()).toBe('2026-10-10T04:40:00.000Z');
    expect(open.dedupeKey).toBe('routine_slot:rs1:2026-10-10');
    expect(await run(fixture(), { localTime: '10:39' })).toHaveLength(1);
    expect(await run(fixture(), { localTime: '10:40' })).toEqual([]);
  });

  it('skips a cancelled slot and non-working days', async () => {
    expect(await run(fixture({ slots: [slot({ cancelled: true })] }))).toEqual([]);
    expect(await run(fixture(), { isWorkingDay: false })).toEqual([]);
  });

  it('a substituted slot goes to the substitute only', async () => {
    const f = fixture({ slots: [slot({ substituted: true, teacher_ids: ['SUB'] })] });
    const [finding] = await run(f);
    expect(finding.recipients).toEqual([{ userId: 'u-SUB', role: UserRole.TEACHER }]);
  });

  it('counts not-submitted students of that section and subject only', async () => {
    loadNotSubmitted.mockResolvedValue([
      { sectionId: SEC, subjectId: MATH },
      { sectionId: SEC, subjectId: MATH },
      { sectionId: SEC, subjectId: 'art' },
      { sectionId: 'other', subjectId: MATH },
    ]);
    const [finding] = await run(fixture());
    expect(finding.params.notSubmitted).toBe(2);
  });

  it('local-midnight edge: the Dhaka date is resolved and a 00:05 period is open at 00:00', async () => {
    const f = fixture({ slots: [slot({ period_slot_id: 'p3' })] });
    const findings = await run(f, {
      now: new Date('2026-10-09T18:00:00Z'),
      localDate: '2026-10-10',
      localTime: '00:00',
    });
    expect(f.resolveTenantDay).toHaveBeenCalledWith('t1', '2026-10-10');
    expect(findings).toHaveLength(1);
  });
});

describe('RoutineSubstitutionTodayRule', () => {
  it('groups two covered periods into one finding per substitute, earliest first', async () => {
    const f = fixture({
      slots: [
        slot({
          routine_slot_id: 'a',
          period_slot_id: 'p1',
          substituted: true,
          substitute_teacher_id: 'SUB',
          teacher_ids: ['SUB'],
        }),
        slot({
          routine_slot_id: 'b',
          period_slot_id: 'p2',
          substituted: true,
          substitute_teacher_id: 'SUB',
          teacher_ids: ['SUB'],
        }),
        slot({ routine_slot_id: 'c' }), // not covered
      ],
    });
    const findings = await new RoutineSubstitutionTodayRule(
      f.ds as never,
      f.resolve as never,
    ).evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].dedupeKey).toBe('teacher:SUB:2026-10-10');
    expect(findings[0].params).toEqual({ count: 2, firstSection: '7-B', firstAt: '08:00' });
    expect(f.resolveTenantDay).toHaveBeenCalledTimes(1);
  });
});

describe('RoutineUncoveredPeriodsRule', () => {
  const leave = [{ staff_profile_id: 'sp-T1' }];
  const run = (f: ReturnType<typeof fixture>, over: Partial<RuleContext> = {}) =>
    new RoutineUncoveredPeriodsRule(f.ds as never, f.resolve as never).evaluate(ctx(over));

  it('counts a period of a teacher on leave while it is still to come or running', async () => {
    const f = fixture({ leaves: leave });
    const [finding] = await run(f, { localTime: '10:30' });
    expect(finding.params).toEqual({ count: 1, firstSection: '7-B', firstAt: '10:00' });
    expect(finding.recipients).toEqual([{ userId: 'exec', role: UserRole.EXECUTIVE }]);
    expect(await run(fixture({ leaves: leave }), { localTime: '10:40' })).toEqual([]);
  });

  it('a substituted period, or a teacher not on leave, is not counted', async () => {
    const substituted = fixture({
      leaves: leave,
      slots: [slot({ substituted: true, teacher_ids: ['SUB'] })],
    });
    expect(await run(substituted)).toEqual([]);
    expect(await run(fixture())).toEqual([]);
  });

  it('non-working day: nothing', async () => {
    expect(await run(fixture({ leaves: leave }), { isWorkingDay: false })).toEqual([]);
  });
});
