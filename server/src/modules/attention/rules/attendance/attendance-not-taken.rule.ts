import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity, UserRole } from '@biddaloy/shared';
import { resolveAttendancePolicy } from '../../../attendance/attendance-policy.util';
import { toPeriods, type ResolvedPeriod } from '../../../attendance/attendance-periods.util';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { SchoolsService } from '../../../schools/schools.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import {
  pickEscalation,
  type AttentionRule as AttentionRuleShape,
  type EscalationStep,
  type RuleContext,
  type RuleFinding,
} from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

/** `'08:00'` or a Postgres `time` `'08:00:00'` -> minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * D10 / D21 ladder for the day register: REMINDER from the first period,
 * WARNING after `graceMinutes`, CRITICAL (heads added) at the absence cutoff.
 */
export function attendanceStep(
  localTime: string,
  firstStart: string,
  graceMinutes: number,
  cutoff: string,
  escalateToHeads: boolean,
): EscalationStep | 'BEFORE_START' | 'LEVEL_0' {
  const elapsed = toMinutes(localTime) - toMinutes(firstStart);
  if (elapsed < 0) return 'BEFORE_START';
  const steps: EscalationStep[] = [
    { level: 1, after: { minutes: graceMinutes }, severity: AlertSeverity.WARNING, addRoles: [] },
    {
      level: 2,
      after: { minutes: Math.max(0, toMinutes(cutoff) - toMinutes(firstStart)) },
      severity: AlertSeverity.CRITICAL,
      addRoles: escalateToHeads ? [UserRole.EXECUTIVE, UserRole.ADMIN] : [],
    },
  ];
  return pickEscalation(steps, { minutes: elapsed, schoolDays: 0 }) ?? 'LEVEL_0';
}

interface HomeroomTeacher {
  teacherId: string;
  staffProfileId: string;
}

/**
 * D22: who is asked to take the day register. The class teachers who are
 * not on leave; if all of them are (or there is none), the assistants who
 * are not on leave plus whoever covers a class teacher's periods today.
 */
export function dayRegisterTeachers(input: {
  classTeachers: HomeroomTeacher[];
  assistants: HomeroomTeacher[];
  onLeaveStaffProfileIds: Set<string>;
  substituteTeacherIdsFor: (classTeacherId: string) => string[];
}): string[] {
  const away = (t: HomeroomTeacher) => input.onLeaveStaffProfileIds.has(t.staffProfileId);
  const present = input.classTeachers.filter((t) => !away(t));
  if (present.length) return [...new Set(present.map((t) => t.teacherId))];
  return [
    ...new Set([
      ...input.assistants.filter((t) => !away(t)).map((t) => t.teacherId),
      ...input.classTeachers.flatMap((t) => input.substituteTeacherIdsFor(t.teacherId)),
    ]),
  ];
}

@AttentionRule()
export class AttendanceNotTakenRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('attendance.not_taken');
  readonly messages = {
    en: {
      title: 'Attendance not taken: {sectionLabel}',
      why: '{register_en} attendance for {sectionLabel} was due at {startsAt} and has not been submitted yet.',
      steps: [
        'Open the register for {sectionLabel}.',
        'Mark every student.',
        'Press "Submit attendance".',
      ],
      action: 'Take attendance',
    },
    bn: {
      title: 'উপস্থিতি নেওয়া হয়নি: {sectionLabel}',
      why: '{sectionLabel}-এর {register_bn} উপস্থিতি {startsAt}-এ নেওয়ার কথা ছিল, এখনো জমা দেওয়া হয়নি।',
      steps: [
        '{sectionLabel}-এর উপস্থিতি খাতা খুলুন।',
        'প্রত্যেক শিক্ষার্থীর উপস্থিতি দিন।',
        '"উপস্থিতি জমা দিন" চাপুন।',
      ],
      action: 'উপস্থিতি নিন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
    private readonly resolveRoutine: ResolveRoutineService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!ctx.isWorkingDay) return []; // D10
    const t = ctx.tenantId;
    const policy = resolveAttendancePolicy(await this.schools.getResolvedSettings(t));
    const cutoff = policy.autoAbsentNotification.cutoffTime;
    const perPeriod = policy.periodAttendance?.enabled === true;
    const grace = ctx.settings.attendanceGraceMinutes;
    const q = <R>(sql: string, params: unknown[]): Promise<R[]> =>
      this.dataSource.query(sql, params);

    const [sections, holidayClasses, slots, sessions, homeroom, leaves] = await Promise.all([
      q<{ id: string; class_id: string; label: string }>(
        `SELECT cs.id, cs.class_id, c.name || '-' || cs.section_name AS label
         FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
         JOIN academic_years y ON y.id = c.academic_year_id AND y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
         WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL`,
        [t],
      ),
      q<{ class_id: string }>(
        `SELECT DISTINCT ec.class_id FROM calendar_events h
         JOIN calendar_event_classes ec ON ec.event_id = h.id AND ec.tenant_id = $1
         WHERE h.tenant_id = $1 AND h.deleted_at IS NULL AND h.published_at IS NOT NULL
           AND h.counts_as_working_day = false AND h.start_date <= $2 AND h.end_date >= $2`,
        [t, ctx.localDate],
      ),
      this.resolveRoutine.resolveTenantDay(t, ctx.localDate),
      q<{ section_id: string; period_no: number | null; state: string }>(
        `SELECT section_id, period_no, state FROM attendance_sessions WHERE tenant_id = $1 AND date = $2`,
        [t, ctx.localDate],
      ),
      q<{
        section_id: string;
        assignment_type: string;
        teacher_id: string;
        staff_profile_id: string | null;
        user_id: string;
      }>(
        `SELECT tcs.section_id, tcs.assignment_type, te.id AS teacher_id, te.staff_profile_id, te.user_id
         FROM teacher_class_sections tcs
         JOIN teachers te ON te.id = tcs.teacher_id AND te.tenant_id = $1 AND te.deleted_at IS NULL
         JOIN users u ON u.id = te.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         WHERE tcs.tenant_id = $1 AND tcs.assignment_type IN ('CLASS_TEACHER','ASSISTANT_CLASS_TEACHER')`,
        [t],
      ),
      q<{ staff_profile_id: string }>(
        `SELECT staff_profile_id FROM leave_records
         WHERE tenant_id = $1 AND status = 'APPROVED' AND start_date <= $2 AND end_date >= $2`,
        [t, ctx.localDate],
      ),
    ]);

    const periodIds = [...new Set(slots.map((s) => s.period_slot_id))];
    const teacherIds = [
      ...new Set(
        slots.flatMap((s) => [
          ...s.teacher_ids,
          ...(s.substitute_teacher_id ? [s.substitute_teacher_id] : []),
        ]),
      ),
    ];
    const [periodSlots, teacherUsers] = await Promise.all([
      periodIds.length
        ? q<{
            id: string;
            sequence: number;
            name: string | null;
            starts_at: string;
            ends_at: string;
          }>(
            `SELECT id, sequence, name, to_char(starts_at,'HH24:MI') AS starts_at, to_char(ends_at,'HH24:MI') AS ends_at
             FROM period_slots WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
            [t, periodIds],
          )
        : [],
      teacherIds.length
        ? q<{ id: string; user_id: string }>(
            `SELECT te.id, te.user_id FROM teachers te
             JOIN users u ON u.id = te.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
             WHERE te.tenant_id = $1 AND te.deleted_at IS NULL AND te.id = ANY($2::uuid[])`,
            [t, teacherIds],
          )
        : [],
    ]);

    const userOfTeacher = new Map(teacherUsers.map((r) => [r.id, r.user_id]));
    for (const h of homeroom) userOfTeacher.set(h.teacher_id, h.user_id);
    const onLeave = new Set(leaves.map((l) => l.staff_profile_id));
    const holiday = new Set(holidayClasses.map((h) => h.class_id));
    const finalized = new Set(
      sessions
        .filter((s) => s.state === 'FINALIZED')
        .map((s) => `${s.section_id}|${s.period_no ?? ''}`),
    );
    const slotsOf = new Map<string, typeof slots>();
    for (const s of slots) slotsOf.set(s.section_id, [...(slotsOf.get(s.section_id) ?? []), s]);

    type Draft = Omit<RuleFinding, 'recipients'> & { teacherUsers: string[]; heads: UserRole[] };
    const drafts: Draft[] = [];
    const expiresAt = endOfLocalDay(ctx.localDate, ctx.tz);

    for (const sec of sections) {
      if (holiday.has(sec.class_id)) continue;
      const sectionSlots = slotsOf.get(sec.id) ?? [];
      const periods: ResolvedPeriod[] = toPeriods(sectionSlots, periodSlots);
      // ponytail: no routine -> the school's late-after time stands in for the first bell.
      const firstStart = periods[0]?.starts_at ?? policy.lateAfter;
      const base = { sectionId: sec.id, sectionLabel: sec.label };

      // Day register.
      const step = attendanceStep(
        ctx.localTime,
        firstStart,
        grace,
        cutoff,
        ctx.settings.escalateAttendanceToHeads,
      );
      if (step !== 'BEFORE_START' && !finalized.has(`${sec.id}|`)) {
        const rows = homeroom.filter((h) => h.section_id === sec.id);
        const asTeacher = (h: (typeof rows)[number]) => ({
          teacherId: h.teacher_id,
          staffProfileId: h.staff_profile_id ?? '',
        });
        const teachers = dayRegisterTeachers({
          classTeachers: rows.filter((h) => h.assignment_type === 'CLASS_TEACHER').map(asTeacher),
          assistants: rows
            .filter((h) => h.assignment_type === 'ASSISTANT_CLASS_TEACHER')
            .map(asTeacher),
          onLeaveStaffProfileIds: onLeave,
          substituteTeacherIdsFor: (classTeacherId) =>
            sectionSlots
              .filter(
                (s) =>
                  s.substituted &&
                  s.substitute_teacher_id &&
                  s.covering_for_teacher_ids?.includes(classTeacherId),
              )
              .map((s) => s.substitute_teacher_id!),
        });
        const level = step === 'LEVEL_0' ? null : step;
        const users = teachers.map((id) => userOfTeacher.get(id)).filter((u): u is string => !!u);
        if (users.length || level?.addRoles.length) {
          drafts.push({
            dedupeKey: `section:${sec.id}:${ctx.localDate}`,
            subject: { type: 'section', id: sec.id },
            params: {
              ...base,
              startsAt: firstStart.slice(0, 5),
              register_en: 'Daily',
              register_bn: 'আজকের',
            },
            severity: level?.severity ?? AlertSeverity.REMINDER,
            escalationLevel: level?.level ?? 0,
            actionUrl: `/attendance/${sec.id}?date=${ctx.localDate}`,
            expiresAt,
            teacherUsers: users,
            heads: level?.addRoles ?? [],
          });
        }
      }

      // Period registers (per-period schools only).
      if (!perPeriod) continue;
      for (const p of periods) {
        if (p.starts_at > ctx.localTime || finalized.has(`${sec.id}|${p.period_no}`)) continue;
        const ids = p.substitute_teacher_id ? [p.substitute_teacher_id] : p.teacher_ids;
        const users = ids.map((id) => userOfTeacher.get(id)).filter((u): u is string => !!u);
        if (!users.length) continue;
        const late = toMinutes(ctx.localTime) - toMinutes(p.starts_at) >= grace;
        drafts.push({
          dedupeKey: `section:${sec.id}:${ctx.localDate}:p${p.period_no}`,
          subject: { type: 'section', id: sec.id },
          params: {
            ...base,
            startsAt: p.starts_at.slice(0, 5),
            register_en: `Period ${p.period_no}`,
            register_bn: `${p.period_no} নম্বর পিরিয়ডের`,
          },
          severity: late ? AlertSeverity.WARNING : AlertSeverity.REMINDER,
          escalationLevel: late ? 1 : 0,
          actionUrl: `/attendance/${sec.id}?date=${ctx.localDate}&period=${p.period_no}`,
          expiresAt,
          teacherUsers: users,
          heads: [],
        });
      }
    }

    // Heads only when some finding actually escalated to them.
    const headRoles = [...new Set(drafts.flatMap((d) => d.heads))];
    const heads = headRoles.length ? await roleRecipients(this.dataSource, t, headRoles) : [];
    return drafts.map(({ teacherUsers: users, heads: roles, ...finding }) => ({
      ...finding,
      recipients: [
        ...users.map((userId) => ({ userId, role: UserRole.TEACHER })),
        ...heads.filter((h) => roles.includes(h.role)),
      ],
    }));
  }
}
