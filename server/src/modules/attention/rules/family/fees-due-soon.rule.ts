import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import { addDaysIso } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { childFindings, openFeesByStudent } from './family-data';

/** Open fees falling due in the next 3 days. */
@AttentionRule()
export class FeesDueSoonRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.due_soon');
  readonly messages = {
    en: {
      title: '{studentName}: ৳{amount} fee due by {dueDate}',
      why: 'Paying on time keeps the account clear.',
      steps: ['Open Fees.', 'Pay online or at the school office.'],
      action: 'Open fees',
    },
    bn: {
      title: '{studentName}: {dueDate}-এর মধ্যে ৳{amount} ফি দিতে হবে',
      why: 'সময়মতো দিলে হিসাব পরিষ্কার থাকে।',
      steps: ['ফি পাতা খুলুন।', 'অনলাইনে বা স্কুল অফিসে ফি দিন।'],
      action: 'ফি দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows = await openFeesByStudent(
      this.dataSource,
      ctx.tenantId,
      'sf.due_date BETWEEN $2 AND $3',
      [ctx.localDate, addDaysIso(ctx.localDate, 3)],
    );
    return childFindings(
      this.dataSource,
      this.family,
      ctx.tenantId,
      this.meta,
      // "৳{sum} due by {date}": the sum covers every fee in the window, so the date is the latest.
      rows.map((r) => ({
        studentId: r.student_id,
        dedupeKey: `student:${r.student_id}`,
        params: { amount: Math.round(Number(r.amount)), dueDate: r.last_due },
        actionUrl: `/portal/fees?student=${r.student_id}`,
      })),
    );
  }
}
