import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import { roleRecipients } from '../structure/role-recipients';

@AttentionRule()
export class ExamsSeatPlanMissingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('exams.seat_plan_missing');
  readonly messages = {
    en: {
      title: '{exam} ({className}): {sittings} sittings have no seat plan',
      why: "The first one is on {firstDate}. Without a published seat plan, invigilators don't know who sits where.",
      steps: ['Open Exams › Seat plans.', 'Create a seat plan for these sittings.', 'Publish it.'],
      action: 'Open seat plans',
    },
    bn: {
      title: '{exam} ({className}): {sittings}টি পরীক্ষার আসন বিন্যাস নেই',
      why: 'প্রথমটি {firstDate} তারিখে। আসন বিন্যাস প্রকাশ না করলে পরিদর্শকরা জানবেন না কে কোথায় বসবে।',
      steps: [
        'পরীক্ষা › আসন বিন্যাস খুলুন।',
        'এই পরীক্ষাগুলোর আসন বিন্যাস তৈরি করুন।',
        'প্রকাশ করুন।',
      ],
      action: 'আসন বিন্যাস খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: {
      id: string;
      name: string;
      class_name: string;
      sittings: number;
      first_date: string;
    }[] = await this.dataSource.query(
      `SELECT e.id, e.name, c.name AS class_name, COUNT(*)::int AS sittings, to_char(MIN(es.date), 'YYYY-MM-DD') AS first_date
       FROM exam_schedules es
       JOIN exams e ON e.id = es.exam_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
       JOIN classes c ON c.id = e.class_id AND c.tenant_id = $1
       WHERE es.tenant_id = $1 AND es.deleted_at IS NULL AND es.date BETWEEN $2 AND $3
         AND NOT EXISTS (
           SELECT 1 FROM seat_plan_schedules sps
           JOIN seat_plans sp ON sp.id = sps.seat_plan_id AND sp.tenant_id = $1 AND sp.deleted_at IS NULL AND sp.status = 'PUBLISHED'
           WHERE sps.tenant_id = $1 AND sps.exam_schedule_id = es.id AND sps.deleted_at IS NULL)
       GROUP BY e.id, e.name, c.name`,
      [ctx.tenantId, ctx.localDate, addDaysIso(ctx.localDate, 3)],
    );
    if (!rows.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return rows.map((r) => ({
      dedupeKey: `exam:${r.id}`,
      subject: { type: 'exam', id: r.id },
      params: {
        exam: r.name,
        className: r.class_name,
        sittings: r.sittings,
        firstDate: r.first_date,
      },
      actionUrl: '/exams/seat-plans',
      recipients,
    }));
  }
}
