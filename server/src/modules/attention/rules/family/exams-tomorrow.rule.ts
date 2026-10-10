import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import { addDaysIso, localDateTimeToUtc } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { childFindings } from './family-data';

/** Runs at `eveningAt`: `EVENING_RULE_KEYS` decides that, no time gate here. */
@AttentionRule()
export class ExamsTomorrowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('exams.tomorrow');
  readonly messages = {
    en: {
      title: '{studentName} has an exam tomorrow',
      why: '{subjects_en} on {date}, first one at {startsAt}.',
      steps: ['Check the exam schedule.', 'Get everything needed ready tonight.'],
      action: 'See exam schedule',
    },
    bn: {
      title: 'আগামীকাল {studentName}-এর পরীক্ষা',
      why: '{date} তারিখে {subjects_bn}, প্রথমটি {startsAt}-এ।',
      steps: ['পরীক্ষার সময়সূচি দেখুন।', 'প্রয়োজনীয় সবকিছু আজ রাতেই গুছিয়ে রাখুন।'],
      action: 'সময়সূচি দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const tomorrow = addDaysIso(ctx.localDate, 1);
    // Only exams whose every component subject is scheduled (families can see the schedule).
    const rows: {
      student_id: string;
      subjects_en: string;
      subjects_bn: string;
      starts_at: string;
    }[] = await this.dataSource.query(
      `SELECT st.id AS student_id, string_agg(sub.name_en, ', ' ORDER BY es.starts_at) AS subjects_en,
              string_agg(COALESCE(sub.name_bn, sub.name_en), ', ' ORDER BY es.starts_at) AS subjects_bn,
              to_char(MIN(es.starts_at), 'HH24:MI') AS starts_at
       FROM exam_schedules es
       JOIN exams e ON e.id = es.exam_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
       JOIN subjects sub ON sub.id = es.subject_id AND sub.tenant_id = $1
       JOIN class_sections cs ON cs.class_id = e.class_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
       JOIN students st ON st.class_section_id = cs.id AND st.tenant_id = $1 AND st.deleted_at IS NULL AND st.enrollment_status = 'ACTIVE'
       WHERE es.tenant_id = $1 AND es.deleted_at IS NULL AND es.date = $2
         AND NOT EXISTS (SELECT 1 FROM exam_components ec WHERE ec.tenant_id = $1 AND ec.exam_id = e.id AND ec.deleted_at IS NULL
                         AND NOT EXISTS (SELECT 1 FROM exam_schedules s2 WHERE s2.tenant_id = $1 AND s2.exam_id = e.id AND s2.subject_id = ec.subject_id AND s2.deleted_at IS NULL))
       GROUP BY st.id`,
      [ctx.tenantId, tomorrow],
    );
    return childFindings(
      this.dataSource,
      this.family,
      ctx.tenantId,
      this.meta,
      rows.map((r) => ({
        studentId: r.student_id,
        dedupeKey: `student:${r.student_id}:${tomorrow}`,
        params: {
          subjects_en: r.subjects_en,
          subjects_bn: r.subjects_bn,
          startsAt: r.starts_at,
          date: tomorrow,
        },
        // Gone once the first paper starts.
        expiresAt: localDateTimeToUtc(tomorrow, r.starts_at, ctx.tz),
        actionUrl: `/portal/exam-schedule?student=${r.student_id}`,
      })),
    );
  }
}
