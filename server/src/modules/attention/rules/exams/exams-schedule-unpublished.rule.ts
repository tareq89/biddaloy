import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import { roleRecipients } from '../structure/role-recipients';

/** Families only see a schedule once every subject with a component has a sitting (`isScheduleComplete`). */
@AttentionRule()
export class ExamsScheduleUnpublishedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('exams.schedule_unpublished');
  readonly messages = {
    en: {
      title: "Families can't see the {exam} ({className}) schedule yet",
      why: 'The exam starts on {firstDate}, but {unscheduled} subjects have no date yet. Families only see the schedule once every subject has one.',
      steps: ['Open the exam.', 'Add a date and time for every subject.'],
      action: 'Open exam',
    },
    bn: {
      title: '{exam} ({className})-এর সময়সূচি অভিভাবকরা এখনো দেখতে পাচ্ছেন না',
      why: 'পরীক্ষা শুরু {firstDate} তারিখে, কিন্তু {unscheduled}টি বিষয়ের তারিখ এখনো দেওয়া হয়নি। সব বিষয়ের তারিখ না দিলে সময়সূচি দেখা যায় না।',
      steps: ['পরীক্ষাটি খুলুন।', 'প্রতিটি বিষয়ের তারিখ ও সময় দিন।'],
      action: 'পরীক্ষা খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: {
      id: string;
      name: string;
      class_name: string;
      first_date: string;
      unscheduled: number;
    }[] = await this.dataSource.query(
      `SELECT e.id, e.name, c.name AS class_name, to_char(MIN(es.date), 'YYYY-MM-DD') AS first_date,
         (SELECT COUNT(DISTINCT ec.subject_id) FROM exam_components ec
           WHERE ec.tenant_id = $1 AND ec.exam_id = e.id AND ec.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM exam_schedules s2 WHERE s2.tenant_id = $1 AND s2.exam_id = e.id
                             AND s2.subject_id = ec.subject_id AND s2.deleted_at IS NULL))::int AS unscheduled
       FROM exams e
       JOIN classes c ON c.id = e.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
       JOIN exam_schedules es ON es.exam_id = e.id AND es.tenant_id = $1 AND es.deleted_at IS NULL
       WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.status = 'DRAFT'
       GROUP BY e.id, e.name, c.name
       HAVING MIN(es.date) BETWEEN $2 AND $3`,
      [ctx.tenantId, ctx.localDate, addDaysIso(ctx.localDate, 14)],
    );
    const open = rows.filter((r) => r.unscheduled > 0);
    if (!open.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    // ponytail: an exam with no sitting at all has no date to judge by, so it is not flagged.
    return open.map((r) => ({
      dedupeKey: `exam:${r.id}`,
      subject: { type: 'exam', id: r.id },
      params: {
        exam: r.name,
        className: r.class_name,
        firstDate: r.first_date,
        unscheduled: r.unscheduled,
      },
      actionUrl: `/exams/${r.id}`,
      recipients,
    }));
  }
}
