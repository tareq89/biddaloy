import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import { roleRecipients } from '../structure/role-recipients';

/** Open fees whose due date fell in the last 7 days. */
@AttentionRule()
export class FeesOverdueRisingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.overdue_rising');
  readonly messages = {
    en: {
      title: '{count} fees became overdue this week',
      why: '{students} students now owe ৳{amount} that fell due in the last 7 days.',
      steps: [
        'Open Fees › Dues.',
        'Sort by amount and check the new overdue fees.',
        'Send reminders to those families.',
      ],
      action: 'Open dues',
    },
    bn: {
      title: 'এই সপ্তাহে {count}টি ফি বকেয়া হয়েছে',
      why: 'গত ৭ দিনে যে ফি জমার সময় পেরিয়েছে, তাতে {students} জন শিক্ষার্থীর ৳{amount} বাকি।',
      steps: [
        'ফি › বকেয়া খুলুন।',
        'টাকার পরিমাণ অনুযায়ী সাজিয়ে নতুন বকেয়াগুলো দেখুন।',
        'সেই পরিবারগুলোকে রিমাইন্ডার পাঠান।',
      ],
      action: 'বকেয়া দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // student_fees has no tenant_id: scope it through students.
    const [row]: { count: number; students: number; amount: string }[] =
      await this.dataSource.query(
        `SELECT COUNT(*)::int AS count, COUNT(DISTINCT sf.student_id)::int AS students,
                COALESCE(SUM(sf.total_amount - sf.paid_amount - sf.discount_amount), 0)::numeric AS amount
         FROM student_fees sf
         JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
         WHERE sf.deleted_at IS NULL AND sf.status IN ('PENDING','PARTIALLY_PAID')
           AND sf.due_date >= $2 AND sf.due_date < $3`,
        [ctx.tenantId, addDaysIso(ctx.localDate, -7), ctx.localDate],
      );
    if (!row || row.count === 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: {
          count: row.count,
          students: row.students,
          amount: Math.round(Number(row.amount)),
        },
        actionUrl: '/fees/dues',
        recipients,
      },
    ];
  }
}
