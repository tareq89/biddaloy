import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, AttendanceStatus, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { AttentionRule, RuleContext } from '../rule.types';
import { ClassAbsentStreakRule } from './class-absent-streak.rule';
import { ClassGuardianContactMissingRule } from './class-guardian-contact-missing.rule';

const ctxAt = (iso: string, localDate: string): RuleContext => ({
  tenantId: 'T',
  now: new Date(iso),
  tz: 'Asia/Dhaka',
  localDate,
  localTime: '11:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
});
const ctx = ctxAt('2026-10-10T05:00:00Z', '2026-10-10');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

function expectMessagesSane(rule: AttentionRule, key: string, params: Record<string, unknown>) {
  expect(rule.meta).toEqual(alertRuleMeta(key as never));
  for (const lang of ['en', 'bn'] as const) {
    const m = rule.messages[lang];
    expect(m.steps.length).toBeLessThanOrEqual(3);
    for (const p of [m.title, m.why, ...m.steps, m.action ?? ''].flatMap(placeholders)) {
      expect(Object.keys(params)).toContain(p);
    }
  }
  const en = placeholders(rule.messages.en.title + rule.messages.en.why);
  const bn = placeholders(rule.messages.bn.title + rule.messages.bn.why);
  expect(bn.filter((p) => !en.includes(p))).toEqual([]);
}

// Homeroom rows: S1 has one class teacher; S2 has none (so it is absent from the result).
const HT_ROWS = [{ sectionId: 'S1', userId: 'ct1', sectionLabel: 'Six-A' }];
const TEACHER_RECIPIENTS = [{ userId: 'ct1', role: UserRole.TEACHER }];

describe('ClassAbsentStreakRule', () => {
  // Sessions come newest first, like the SQL returns them.
  const sessions = (...dates: string[]) =>
    dates.map((d, i) => ({ id: `ses${i}`, section_id: 'S1', date: d }));
  const rec = (sessionId: string, studentId: string, status: AttendanceStatus) => ({
    session_id: sessionId,
    student_id: studentId,
    status,
  });
  const make = (sess: object[], recs: object[]) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(HT_ROWS)
      .mockResolvedValueOnce(sess)
      .mockResolvedValueOnce(recs)
      .mockResolvedValueOnce([{ id: 'X', full_name: 'Rahim', class_section_id: 'S1' }]);
    return { rule: new ClassAbsentStreakRule({ query } as never), query };
  };
  const threeDays = sessions('2026-10-08', '2026-10-07', '2026-10-06');

  it('fires one finding per ABSENT streak, keyed by the oldest date', async () => {
    const recs = ['ses0', 'ses1', 'ses2'].map((s) => rec(s, 'X', AttendanceStatus.ABSENT));
    const { rule } = make(threeDays, recs);
    const [f] = await rule.evaluate(ctx);
    expect(f.dedupeKey).toBe('student:X:2026-10-06');
    expect(f.params).toEqual({
      studentId: 'X',
      studentName: 'Rahim',
      sectionId: 'S1',
      sectionLabel: 'Six-A',
      days: 3,
      since: '2026-10-06',
    });
    expect(f.subject).toEqual({ type: 'student', id: 'X' });
    expect(f.recipients).toEqual(TEACHER_RECIPIENTS);
    expectMessagesSane(rule, 'class.absent_streak', f.params);
  });

  it('does not fire when the newest day is PRESENT (run is only 2 long)', async () => {
    const recs = [
      rec('ses0', 'X', AttendanceStatus.PRESENT),
      rec('ses1', 'X', AttendanceStatus.ABSENT),
      rec('ses2', 'X', AttendanceStatus.ABSENT),
    ];
    expect(await make(threeDays, recs).rule.evaluate(ctx)).toEqual([]);
  });

  it('ignores LATE and PRESENT streaks (only ABSENT alerts the class teacher)', async () => {
    const late = ['ses0', 'ses1', 'ses2'].map((s) => rec(s, 'X', AttendanceStatus.LATE));
    expect(await make(threeDays, late).rule.evaluate(ctx)).toEqual([]);
  });

  it('does not read sessions when no section has a class teacher', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    expect(await new ClassAbsentStreakRule({ query } as never).evaluate(ctx)).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('uses the tenant-local date as the upper bound of the session query', async () => {
    // Local midnight in Dhaka: 18:00Z is already the next local day.
    const after = ctxAt('2026-10-09T18:00:00Z', '2026-10-10');
    const before = ctxAt('2026-10-09T17:59:59Z', '2026-10-09');
    const a = make([], []);
    await a.rule.evaluate(after);
    expect(a.query.mock.calls[1][1][1]).toBe('2026-10-10');
    const b = make([], []);
    await b.rule.evaluate(before);
    expect(b.query.mock.calls[1][1][1]).toBe('2026-10-09');
    // Tenant id is always the first parameter.
    expect(a.query.mock.calls[1][1][0]).toBe('T');
  });
});

describe('ClassGuardianContactMissingRule', () => {
  const make = (counts: { sectionId: string; count: number }[]) => {
    const query = vi.fn().mockResolvedValueOnce(HT_ROWS).mockResolvedValueOnce(counts);
    return new ClassGuardianContactMissingRule({ query } as never);
  };

  it('returns nothing when no student lacks a phone', async () => {
    expect(await make([]).evaluate(ctx)).toEqual([]);
    expect(await make([{ sectionId: 'S1', count: 0 }]).evaluate(ctx)).toEqual([]);
  });

  it("alerts the section's class teacher only", async () => {
    const rule = make([{ sectionId: 'S1', count: 2 }]);
    const [f] = await rule.evaluate(ctx);
    expect(f.dedupeKey).toBe('section:S1');
    expect(f.params).toEqual({ sectionId: 'S1', sectionLabel: 'Six-A', count: 2 });
    expect(f.actionUrl).toBe('/my-class/S1');
    expect(f.recipients).toEqual(TEACHER_RECIPIENTS);
    expectMessagesSane(rule, 'class.guardian_contact_missing', f.params);
  });

  it('skips sections that have no class teacher', async () => {
    expect(await make([{ sectionId: 'S2', count: 5 }]).evaluate(ctx)).toEqual([]);
  });
});
