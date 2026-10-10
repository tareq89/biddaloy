import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, AlertSeverity, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import {
  AttendanceNotTakenRule,
  attendanceStep,
  dayRegisterTeachers,
  toMinutes,
} from './attendance-not-taken.rule';

describe('toMinutes', () => {
  it('reads HH:mm and Postgres time', () => {
    expect(toMinutes('08:00')).toBe(480);
    expect(toMinutes('08:00:00')).toBe(480);
  });
});

describe('attendanceStep (first period 08:00, grace 15, cutoff 10:00)', () => {
  const step = (t: string, heads = true, cutoff = '10:00') =>
    attendanceStep(t, '08:00', 15, cutoff, heads);

  it('walks the ladder', () => {
    expect(step('07:59')).toBe('BEFORE_START');
    expect(step('08:00')).toBe('LEVEL_0');
    expect(step('08:14')).toBe('LEVEL_0');
    expect(step('08:15')).toMatchObject({ level: 1, severity: AlertSeverity.WARNING });
    expect(step('09:59')).toMatchObject({ level: 1 });
    expect(step('10:00')).toMatchObject({
      level: 2,
      severity: AlertSeverity.CRITICAL,
      addRoles: [UserRole.EXECUTIVE, UserRole.ADMIN],
    });
  });

  it('level 2 adds nobody when heads escalation is off', () => {
    expect(step('10:00', false)).toMatchObject({ level: 2, addRoles: [] });
  });

  it('a cutoff before the first period means level 2 from the first bell', () => {
    expect(step('08:00', true, '07:30')).toMatchObject({ level: 2 });
  });
});

describe('dayRegisterTeachers (D22)', () => {
  const CT = { teacherId: 'CT', staffProfileId: 'sp-CT' };
  const AT = { teacherId: 'AT', staffProfileId: 'sp-AT' };
  const run = (over: Partial<Parameters<typeof dayRegisterTeachers>[0]>) =>
    dayRegisterTeachers({
      classTeachers: [CT],
      assistants: [AT],
      onLeaveStaffProfileIds: new Set(),
      substituteTeacherIdsFor: (id) => (id === 'CT' ? ['SUB'] : []),
      ...over,
    });

  it('the class teacher alone when present', () => {
    expect(run({})).toEqual(['CT']);
  });
  it('class teacher on leave: assistants and substitutes, not the class teacher', () => {
    expect(run({ onLeaveStaffProfileIds: new Set(['sp-CT']) }).sort()).toEqual(['AT', 'SUB']);
  });
  it('assistant also on leave: only the substitute', () => {
    expect(run({ onLeaveStaffProfileIds: new Set(['sp-CT', 'sp-AT']) })).toEqual(['SUB']);
  });
  it('no class teacher row: the assistants', () => {
    expect(run({ classTeachers: [] })).toEqual(['AT']);
  });
});

// ---- evaluate ----------------------------------------------------------
const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T02:20:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '08:20',
  isWorkingDay: true,
  settings: {
    attendanceGraceMinutes: 15,
    escalateAttendanceToHeads: true,
  } as RuleContext['settings'],
  ...extra,
});

interface Fx {
  perPeriod?: boolean;
  sessions?: unknown[];
  slots?: unknown[];
}
function build(f: Fx = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM class_sections cs')) return [{ id: 'S1', class_id: 'C1', label: '7-B' }];
    if (sql.includes('calendar_events')) return [];
    if (sql.includes('FROM attendance_sessions')) return f.sessions ?? [];
    if (sql.includes('FROM teacher_class_sections'))
      return [
        {
          section_id: 'S1',
          assignment_type: 'CLASS_TEACHER',
          teacher_id: 'CT',
          staff_profile_id: 'sp-CT',
          user_id: 'u-CT',
        },
      ];
    if (sql.includes('FROM leave_records')) return [];
    if (sql.includes('FROM period_slots'))
      return [
        { id: 'p1', sequence: 1, name: null, starts_at: '08:00', ends_at: '08:40' },
        { id: 'p2', sequence: 2, name: null, starts_at: '09:00', ends_at: '09:40' },
      ];
    if (sql.includes('FROM teachers te'))
      return [
        { id: 'T2', user_id: 'u-T2' },
        { id: 'SUB', user_id: 'u-SUB' },
      ];
    if (sql.includes('FROM user_tenants')) return [{ userId: 'head', role: UserRole.ADMIN }];
    return [];
  });
  const slot = (period: string, extra = {}) => ({
    section_id: 'S1',
    period_slot_id: period,
    subject_id: 'sub',
    teacher_ids: ['T2'],
    substituted: false,
    cancelled: false,
    ...extra,
  });
  const resolveTenantDay = vi.fn(async () => f.slots ?? [slot('p1')]);
  const schools = {
    getResolvedSettings: vi.fn(async () => ({
      attendance: {
        lateAfter: '09:00',
        autoAbsentNotification: { enabled: true, cutoffTime: '10:00' },
        periodAttendance: { enabled: f.perPeriod ?? false },
      },
    })),
  };
  const rule = new AttendanceNotTakenRule(
    { query } as never,
    schools as never,
    { resolveTenantDay } as never,
  );
  return { rule, query, resolveTenantDay, slot };
}

describe('AttendanceNotTakenRule', () => {
  it('meta, bn/en placeholders match, at most 3 steps', () => {
    const { rule } = build();
    expect(rule.meta).toEqual(alertRuleMeta('attendance.not_taken'));
    const all = (m: (typeof rule.messages)['en']) => [m.title, m.why, ...m.steps].join(' ');
    const names = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].replace(/_(en|bn)$/, '')).sort();
    expect(names(all(rule.messages.en))).toEqual(names(all(rule.messages.bn)));
    expect(rule.messages.en.steps.length).toBeLessThanOrEqual(3);
  });

  it('non-working day: nothing, and no query runs', async () => {
    const { rule, query } = build();
    expect(await rule.evaluate(ctx({ isWorkingDay: false }))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('local-midnight edge: before the first period nothing; at 08:20 a WARNING that expires at Dhaka midnight', async () => {
    const { rule, resolveTenantDay } = build();
    const before = await rule.evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localTime: '00:00' }),
    );
    expect(before).toEqual([]);
    expect(resolveTenantDay).toHaveBeenCalledWith('t1', '2026-10-10');

    const [finding] = await rule.evaluate(ctx());
    expect(finding.dedupeKey).toBe('section:S1:2026-10-10');
    expect(finding.severity).toBe(AlertSeverity.WARNING);
    expect(finding.expiresAt?.toISOString()).toBe('2026-10-10T18:00:00.000Z');
    expect(finding.recipients).toEqual([{ userId: 'u-CT', role: UserRole.TEACHER }]);
  });

  it('after the cutoff the tenant heads are added at CRITICAL', async () => {
    const { rule } = build();
    const [finding] = await rule.evaluate(ctx({ localTime: '10:05' }));
    expect(finding.severity).toBe(AlertSeverity.CRITICAL);
    expect(finding.escalationLevel).toBe(2);
    expect(finding.recipients.map((r) => r.userId).sort()).toEqual(['head', 'u-CT']);
  });

  it('a FINALIZED day session clears the day finding', async () => {
    const { rule } = build({
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
    });
    expect(await rule.evaluate(ctx())).toEqual([]);
  });

  it('per-period: an unfinalized period 2 at 09:20 warns its teacher; a substitute replaces the teacher', async () => {
    const plain = build({
      perPeriod: true,
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
      slots: [build().slot('p2')],
    });
    const [f] = await plain.rule.evaluate(ctx({ localTime: '09:20' }));
    expect(f.dedupeKey).toBe('section:S1:2026-10-10:p2');
    expect(f.severity).toBe(AlertSeverity.WARNING);
    expect(f.recipients).toEqual([{ userId: 'u-T2', role: UserRole.TEACHER }]);

    const covered = build({
      perPeriod: true,
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
      slots: [
        build().slot('p2', {
          substituted: true,
          substitute_teacher_id: 'SUB',
          teacher_ids: ['SUB'],
        }),
      ],
    });
    const [g] = await covered.rule.evaluate(ctx({ localTime: '09:20' }));
    expect(g.recipients).toEqual([{ userId: 'u-SUB', role: UserRole.TEACHER }]);
  });
});
