import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

/** Flagged-dues students nobody has reminded in the last 7 days. */
@AttentionRule()
export class FeesRemindersPendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.reminders_pending');
  readonly messages = {
    en: {
      title: '{students} families need a fee reminder',
      why: 'Their dues passed the reminder date and nobody reminded them in the last 7 days.',
      steps: [
        'Open Communications › Reminders.',
        'Select the flagged students.',
        'Send the reminder.',
      ],
      action: 'Send reminders',
    },
    bn: {
      title: '{students}টি পরিবারকে ফি-র রিমাইন্ডার পাঠানো দরকার',
      why: 'তাদের বকেয়ার রিমাইন্ডারের তারিখ পেরিয়ে গেছে, গত ৭ দিনে কেউ মনে করিয়ে দেয়নি।',
      steps: [
        'যোগাযোগ › রিমাইন্ডার খুলুন।',
        'চিহ্নিত শিক্ষার্থীদের বেছে নিন।',
        'রিমাইন্ডার পাঠান।',
      ],
      action: 'রিমাইন্ডার পাঠান',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { students: number }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT sf.student_id)::int AS students
       FROM student_fees sf
       JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
       WHERE sf.deleted_at IS NULL AND sf.status IN ('PENDING','PARTIALLY_PAID')
         AND sf.reminder_threshold_date < $2::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM communication_logs cl
           WHERE cl.tenant_id = $1 AND cl.student_id = sf.student_id
             AND cl.trigger IN ('BULK_REMINDER','SINGLE_REMINDER') AND cl.created_at >= $3)`,
      [ctx.tenantId, ctx.now, new Date(ctx.now.getTime() - 7 * 24 * 3600_000)],
    );
    if (!row || row.students === 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { students: row.students },
        actionUrl: '/communications/reminders',
        recipients,
      },
    ];
  }
}
