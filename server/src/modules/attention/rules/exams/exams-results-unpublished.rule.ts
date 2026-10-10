import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

@AttentionRule()
export class ExamsResultsUnpublishedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('exams.results_unpublished');
  readonly messages = {
    en: {
      title: 'Results of {exam} ({className}) are ready to publish',
      why: "The results are processed, but families can't see them until you publish.",
      steps: ['Open Results.', 'Check the processed results.', 'Publish them.'],
      action: 'Open results',
    },
    bn: {
      title: '{exam} ({className})-এর ফলাফল প্রকাশের জন্য তৈরি',
      why: 'ফলাফল তৈরি হয়ে গেছে, কিন্তু প্রকাশ না করলে অভিভাবকরা দেখতে পাবেন না।',
      steps: ['ফলাফল পাতা খুলুন।', 'তৈরি হওয়া ফলাফল মিলিয়ে দেখুন।', 'ফলাফল প্রকাশ করুন।'],
      action: 'ফলাফল খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; name: string; class_name: string }[] = await this.dataSource.query(
      `SELECT e.id, e.name, c.name AS class_name
       FROM exams e JOIN classes c ON c.id = e.class_id AND c.tenant_id = $1
       WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.status = 'PROCESSED'`,
      [ctx.tenantId],
    );
    if (!rows.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return rows.map((r) => ({
      dedupeKey: `exam:${r.id}`,
      subject: { type: 'exam', id: r.id },
      params: { exam: r.name, className: r.class_name },
      actionUrl: '/results',
      recipients,
    }));
  }
}
