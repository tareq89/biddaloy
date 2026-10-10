import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { childFindings, openFeesByStudent } from './family-data';

/** Open fees past their due date. Kept without recipients for the D29 SMS fallback. */
@AttentionRule()
export class FeesOverdueFamilyRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.overdue_family');
  readonly messages = {
    en: {
      title: '{studentName}: ৳{amount} fee is overdue',
      why: 'The oldest unpaid fee was due on {oldestDue}.',
      steps: [
        'Open Fees.',
        'Pay online or at the school office.',
        "If you can't pay now, talk to the office.",
      ],
      action: 'Open fees',
    },
    bn: {
      title: '{studentName}: ৳{amount} ফি বকেয়া',
      why: 'সবচেয়ে পুরনো বকেয়া ফি দেওয়ার কথা ছিল {oldestDue} তারিখে।',
      steps: [
        'ফি পাতা খুলুন।',
        'অনলাইনে বা স্কুল অফিসে ফি দিন।',
        'এখন দিতে না পারলে অফিসে কথা বলুন।',
      ],
      action: 'ফি দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows = await openFeesByStudent(this.dataSource, ctx.tenantId, 'sf.due_date < $2', [
      ctx.localDate,
    ]);
    return childFindings(
      this.dataSource,
      this.family,
      ctx.tenantId,
      this.meta,
      rows.map((r) => ({
        studentId: r.student_id,
        dedupeKey: `student:${r.student_id}`,
        params: { amount: Math.round(Number(r.amount)), oldestDue: r.first_due },
        actionUrl: `/portal/fees?student=${r.student_id}`,
      })),
      true, // D29: guardians without a login get the SMS fallback
    );
  }
}
