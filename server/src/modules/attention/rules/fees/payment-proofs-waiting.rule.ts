import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity, ModuleKey } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

/** D30: the item turns red once the oldest waiting proof is older than this. */
const RED_AFTER_MS = 2 * 24 * 3600_000;

/** Guardian payment proofs nobody has confirmed or rejected yet. */
@AttentionRule({ module: ModuleKey.fees })
export class PaymentProofsWaitingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.payment_proofs_waiting');
  readonly messages = {
    en: {
      title: '{count} payment proofs are waiting for review',
      why: 'Guardians sent proof of payment and nobody has confirmed or rejected it yet.',
      steps: [
        'Open Payments › Online › Waiting.',
        'Check each proof against your bKash or bank record.',
        'Confirm it or reject it with a reason.',
      ],
      action: 'Review proofs',
    },
    bn: {
      title: '{count}টি পেমেন্ট প্রমাণ যাচাইয়ের অপেক্ষায়',
      why: 'অভিভাবকরা পেমেন্টের প্রমাণ পাঠিয়েছেন, কিন্তু কেউ এখনও নিশ্চিত বা বাতিল করেননি।',
      steps: [
        'পেমেন্ট › অনলাইন › অপেক্ষমাণ খুলুন।',
        'প্রতিটি প্রমাণ বিকাশ বা ব্যাংকের হিসাবের সাথে মিলিয়ে দেখুন।',
        'নিশ্চিত করুন, অথবা কারণ দিয়ে বাতিল করুন।',
      ],
      action: 'প্রমাণ যাচাই করুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { count: number; oldest: Date | null }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest
       FROM payment_submissions
       WHERE tenant_id = $1 AND source = 'PROOF' AND status = 'PENDING'`,
      [ctx.tenantId],
    );
    if (!row || row.count === 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    const red =
      row.oldest !== null && ctx.now.getTime() - new Date(row.oldest).getTime() > RED_AFTER_MS;
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: row.count },
        actionUrl: '/payments/online?tab=waiting',
        ...(red ? { severity: AlertSeverity.CRITICAL } : {}),
        recipients,
      },
    ];
  }
}
