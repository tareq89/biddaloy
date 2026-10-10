import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

export interface NotSubmittedRow {
  assignmentId: string;
  homeworkId: string;
  title: string;
  subjectId: string;
  subject_en: string;
  subject_bn: string;
  sectionId: string;
  sectionLabel: string;
  studentId: string;
  studentName: string;
}

/**
 * The one definition of "still owes this homework" (67.3.05 imports it).
 * A submission row exists only after the student uploads, so not submitted
 * = no row, or a row still `NOT_SUBMITTED`.
 */
export async function loadNotSubmitted(
  ds: DataSource,
  tenantId: string,
  dueDate: string,
): Promise<NotSubmittedRow[]> {
  return ds.query(
    `SELECT x.assignment_id AS "assignmentId", h.id AS "homeworkId", h.title, h.subject_id AS "subjectId",
            sub.name_en AS subject_en, COALESCE(sub.name_bn, sub.name_en) AS subject_bn,
            x.section_id AS "sectionId", c.name || '-' || cs.section_name AS "sectionLabel",
            x.student_id AS "studentId", st.full_name AS "studentName"
     FROM (
       SELECT ha.id AS assignment_id, ha.homework_id, ha.section_id, s.id AS student_id
       FROM homework_assignments ha
       JOIN students s ON s.class_section_id = ha.section_id AND s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
       WHERE ha.tenant_id = $1 AND ha.status = 'ACTIVE' AND ha.due_date = $2 AND ha.section_id IS NOT NULL
       UNION ALL
       SELECT ha.id, ha.homework_id, s.class_section_id, s.id
       FROM homework_assignments ha
       JOIN students s ON s.id = ha.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
       WHERE ha.tenant_id = $1 AND ha.status = 'ACTIVE' AND ha.due_date = $2 AND ha.student_id IS NOT NULL
     ) x
     JOIN homework h ON h.id = x.homework_id AND h.tenant_id = $1
     JOIN subjects sub ON sub.id = h.subject_id AND sub.tenant_id = $1
     JOIN students st ON st.id = x.student_id AND st.tenant_id = $1
     JOIN class_sections cs ON cs.id = x.section_id AND cs.tenant_id = $1
     JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
     LEFT JOIN homework_submissions hs ON hs.assignment_id = x.assignment_id AND hs.student_id = x.student_id AND hs.tenant_id = $1
     WHERE hs.id IS NULL OR hs.status = 'NOT_SUBMITTED'`,
    [tenantId, dueDate],
  );
}

/**
 * Subject teachers per `section|subject`: the write scope of
 * `TeacherScopeService.rolesInSection` (live teacher, live subject).
 */
export async function loadSubjectTeachers(
  ds: DataSource,
  tenantId: string,
  sectionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!sectionIds.length) return map;
  const rows: { sectionId: string; subjectId: string; userId: string }[] = await ds.query(
    `SELECT tcs.section_id AS "sectionId", tcs.subject_id AS "subjectId", t.user_id AS "userId"
     FROM teacher_class_sections tcs
     JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
     JOIN users u ON u.id = t.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
     JOIN subjects s ON s.id = tcs.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
     WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'SUBJECT_TEACHER' AND tcs.section_id = ANY($2::uuid[])`,
    [tenantId, sectionIds],
  );
  for (const r of rows) {
    const key = `${r.sectionId}|${r.subjectId}`;
    map.set(key, [...(map.get(key) ?? []), r.userId]);
  }
  return map;
}

/** First title, with an ellipsis when the group holds more than one. */
export function titleOf(titles: string[]): string {
  const distinct = [...new Set(titles)].sort();
  return distinct[0] + (distinct.length > 1 ? ' …' : '');
}

// ponytail: no routine at all — fixed fallback
const NO_ROUTINE_FALLBACK = '16:00';
/**
 * FAST sweeps stop at the school's last period end and tick every 5 min
 * (not clock-aligned), so a trigger AT that minute is usually skipped.
 * Two ticks of margin keep the last trigger inside the window.
 */
const CLOSING_MARGIN_MINUTES = 10;

function minusMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.max(0, h * 60 + m - mins);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

@AttentionRule()
export class HomeworkNotSubmittedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('homework.not_submitted');
  readonly messages = {
    en: {
      title: '{headline_en}',
      why: 'It was due today before the {subject_en} class: "{hwTitle}".',
      steps: ['{step1_en}', '{step2_en}'],
      action: 'Open homework',
    },
    bn: {
      title: '{headline_bn}',
      why: 'আজ {subject_bn} ক্লাসের আগে জমা দেওয়ার কথা ছিল: "{hwTitle}"।',
      steps: ['{step1_bn}', '{step2_bn}'],
      action: 'বাড়ির কাজ দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolveRoutine: ResolveRoutineService,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!ctx.isWorkingDay) return [];
    const rows = await loadNotSubmitted(this.dataSource, ctx.tenantId, ctx.localDate);
    if (!rows.length) return [];

    const triggers = await this.triggerTimes(ctx);
    const active = rows.filter((r) => ctx.localTime >= triggers.at(r.sectionId, r.subjectId));
    if (!active.length) return [];

    const [familyUsers, teachers] = await Promise.all([
      this.family.familyUsersForStudents(ctx.tenantId, [
        ...new Set(active.map((r) => r.studentId)),
      ]),
      loadSubjectTeachers(this.dataSource, ctx.tenantId, [
        ...new Set(active.map((r) => r.sectionId)),
      ]),
    ]);
    const expiresAt = endOfLocalDay(ctx.localDate, ctx.tz);
    const findings: RuleFinding[] = [];

    for (const r of active) {
      const recipients = familyUsers
        .filter((f) => f.studentId === r.studentId)
        .map((f) => ({ userId: f.userId, role: f.role, studentId: r.studentId }));
      if (!recipients.length) continue;
      findings.push({
        dedupeKey: `student:${r.studentId}:${ctx.localDate}:${r.assignmentId}`,
        subject: { type: 'student', id: r.studentId },
        params: {
          studentId: r.studentId,
          studentName: r.studentName,
          sectionId: r.sectionId,
          sectionLabel: r.sectionLabel,
          subject_en: r.subject_en,
          subject_bn: r.subject_bn,
          hwTitle: r.title,
          headline_en: `${r.studentName} has not submitted the ${r.subject_en} homework`,
          headline_bn: `${r.studentName} ${r.subject_bn} বাড়ির কাজ জমা দেয়নি`,
          step1_en: 'Finish the homework today.',
          step1_bn: 'আজই বাড়ির কাজটি শেষ করো।',
          step2_en: 'Hand it to the teacher, or ask the teacher what to do now.',
          step2_bn: 'শিক্ষকের কাছে জমা দাও, অথবা এখন কী করতে হবে শিক্ষককে জিজ্ঞেস করো।',
        },
        expiresAt,
        recipients,
      });
    }

    const groups = new Map<string, NotSubmittedRow[]>();
    for (const r of active) {
      const key = `${r.sectionId}|${r.subjectId}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [key, group] of groups) {
      const userIds = teachers.get(key);
      if (!userIds?.length) continue;
      const { sectionId, subjectId, sectionLabel, subject_en, subject_bn } = group[0];
      const count = group.length;
      findings.push({
        dedupeKey: `section:${sectionId}:${ctx.localDate}:${subjectId}`,
        subject: { type: 'section', id: sectionId },
        params: {
          sectionId,
          sectionLabel,
          subject_en,
          subject_bn,
          hwTitle: titleOf(group.map((g) => g.title)),
          count,
          headline_en: `${sectionLabel}: ${count} students have not submitted the ${subject_en} homework`,
          headline_bn: `${sectionLabel}: ${count} জন শিক্ষার্থী ${subject_bn} বাড়ির কাজ জমা দেয়নি`,
          step1_en: `Open the homework list for ${sectionLabel}.`,
          step1_bn: `${sectionLabel}-এর বাড়ির কাজের তালিকা খুলুন।`,
          step2_en: 'Remind the students, or mark late submissions.',
          step2_bn: 'শিক্ষার্থীদের মনে করিয়ে দিন, অথবা দেরিতে জমা দেওয়াগুলো চিহ্নিত করুন।',
        },
        actionUrl: `/academics/homework?section_id=${sectionId}&subject_id=${subjectId}`,
        expiresAt,
        recipients: userIds.map((userId) => ({ userId, role: UserRole.TEACHER })),
      });
    }
    return findings;
  }

  /**
   * D9: the first period of the subject for the section today; else the
   * section's last period end ("school end"); else the school's last period
   * end; else a fixed fallback. Any trigger is clamped to
   * `CLOSING_MARGIN_MINUTES` before the school's last period end, so a FAST
   * tick still sees it. One `resolveTenantDay` + one period query.
   */
  private async triggerTimes(ctx: RuleContext) {
    const [slots, periods] = await Promise.all([
      this.resolveRoutine.resolveTenantDay(ctx.tenantId, ctx.localDate),
      this.dataSource.query(
        `SELECT id, to_char(starts_at,'HH24:MI') AS start, to_char(ends_at,'HH24:MI') AS "end"
         FROM period_slots WHERE tenant_id = $1 AND kind = 'CLASS'`,
        [ctx.tenantId],
      ) as Promise<{ id: string; start: string; end: string }[]>,
    ]);
    const period = new Map(periods.map((p) => [p.id, p]));
    const firstStart = new Map<string, string>();
    const lastEnd = new Map<string, string>();
    for (const s of slots) {
      if (s.cancelled) continue;
      const p = period.get(s.period_slot_id);
      if (!p) continue;
      const key = `${s.section_id}|${s.subject_id}`;
      if (!firstStart.has(key) || p.start < firstStart.get(key)!) firstStart.set(key, p.start);
      if (!lastEnd.has(s.section_id) || p.end > lastEnd.get(s.section_id)!)
        lastEnd.set(s.section_id, p.end);
    }
    const lastPeriodEnd = periods
      .map((p) => p.end)
      .sort()
      .pop();
    const schoolEnd = lastPeriodEnd ?? NO_ROUTINE_FALLBACK;
    const closing = lastPeriodEnd && minusMinutes(lastPeriodEnd, CLOSING_MARGIN_MINUTES);
    return {
      at: (sectionId: string, subjectId: string) => {
        const t =
          firstStart.get(`${sectionId}|${subjectId}`) ?? lastEnd.get(sectionId) ?? schoolEnd;
        return closing && t > closing ? closing : t;
      },
    };
  }
}
