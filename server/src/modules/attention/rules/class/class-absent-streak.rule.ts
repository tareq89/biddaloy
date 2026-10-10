import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, AttendanceStatus } from '@biddaloy/shared';
import { currentStreaks, MAX_STREAK_SESSIONS } from '../../../attendance/attendance-streaks.util';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadHomeroomSections } from './class-homeroom';

@AttentionRule()
export class ClassAbsentStreakRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('class.absent_streak');
  readonly messages = {
    en: {
      title: '{studentName} has been absent {days} school days in a row',
      why: '{sectionLabel}: absent every school day since {since}. A call home often helps.',
      steps: [
        "Open {studentName}'s profile.",
        'Call a guardian to find out why.',
        'Add a note on the profile.',
      ],
      action: 'Open student',
    },
    bn: {
      title: '{studentName} টানা {days} দিন অনুপস্থিত',
      why: '{sectionLabel}: {since} থেকে প্রতিদিন অনুপস্থিত। অভিভাবকের সাথে কথা বললে প্রায়ই কাজে আসে।',
      steps: [
        '{studentName}-এর প্রোফাইল খুলুন।',
        'কারণ জানতে অভিভাবককে ফোন করুন।',
        'প্রোফাইলে একটি নোট লিখে রাখুন।',
      ],
      action: 'শিক্ষার্থী দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const sections = await loadHomeroomSections(this.dataSource, ctx.tenantId);
    if (sections.size === 0) return [];
    const sectionIds = [...sections.keys()];

    // Newest whole-day sessions per section, same input as getSectionStreaks.
    const sessions: { id: string; section_id: string; date: string }[] =
      await this.dataSource.query(
        `SELECT id, section_id, to_char(date, 'YYYY-MM-DD') AS date FROM (
           SELECT s.id, s.section_id, s.date,
                  ROW_NUMBER() OVER (PARTITION BY s.section_id ORDER BY s.date DESC) AS rn
           FROM attendance_sessions s
           WHERE s.tenant_id = $1 AND s.period_no IS NULL AND s.date <= $2
             AND s.section_id = ANY($3::uuid[])) x
         WHERE rn <= $4 ORDER BY section_id, date DESC`,
        [ctx.tenantId, ctx.localDate, sectionIds, MAX_STREAK_SESSIONS],
      );
    if (sessions.length === 0) return [];

    const records: { session_id: string; student_id: string; status: AttendanceStatus }[] =
      await this.dataSource.query(
        `SELECT session_id, student_id, status FROM attendance_records
         WHERE tenant_id = $1 AND session_id = ANY($2::uuid[])`,
        [ctx.tenantId, sessions.map((s) => s.id)],
      );
    const students: { id: string; full_name: string; class_section_id: string }[] =
      await this.dataSource.query(
        `SELECT id, full_name, class_section_id FROM students
         WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = 'ACTIVE'
           AND class_section_id = ANY($2::uuid[])`,
        [ctx.tenantId, sectionIds],
      );

    const statusBySession = new Map<string, Map<string, AttendanceStatus>>();
    for (const r of records) {
      if (!statusBySession.has(r.student_id)) statusBySession.set(r.student_id, new Map());
      statusBySession.get(r.student_id)!.set(r.session_id, r.status);
    }
    const sessionsBySection = new Map<string, { id: string; date: string }[]>();
    for (const s of sessions) {
      const list = sessionsBySection.get(s.section_id) ?? [];
      list.push(s);
      sessionsBySection.set(s.section_id, list);
    }

    const findings: RuleFinding[] = [];
    for (const [sectionId, sec] of sections) {
      const names = new Map(
        students.filter((s) => s.class_section_id === sectionId).map((s) => [s.id, s.full_name]),
      );
      const streaks = currentStreaks(
        sessionsBySection.get(sectionId) ?? [],
        [...names.keys()],
        statusBySession,
      ).filter((s) => s.status === AttendanceStatus.ABSENT);
      for (const streak of streaks) {
        findings.push({
          dedupeKey: 'student:' + streak.student_id + ':' + streak.since_date,
          subject: { type: 'student', id: streak.student_id },
          params: {
            studentId: streak.student_id,
            studentName: names.get(streak.student_id)!,
            sectionId,
            sectionLabel: sec.sectionLabel,
            days: streak.length,
            since: streak.since_date,
          },
          actionUrl: '/students/' + streak.student_id,
          recipients: sec.recipients,
        });
      }
    }
    return findings;
  }
}
