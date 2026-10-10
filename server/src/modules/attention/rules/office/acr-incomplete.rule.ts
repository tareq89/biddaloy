import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const STALE_MS = 7 * 86_400_000;

@AttentionRule()
export class AcrIncompleteRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('acr.incomplete');
  readonly messages = {
    en: {
      title: '{count} ACR drafts are unfinished',
      why: 'You started these and have not touched them for a week.',
      steps: ['Open the draft.', 'Fill the remaining steps.', 'Mark it complete.'],
      action: 'Open ACR',
    },
    bn: {
      title: '{count}টি এসিআর খসড়া অসম্পূর্ণ',
      why: 'এগুলো আপনি শুরু করেছিলেন, এক সপ্তাহ ধরে আর কাজ হয়নি।',
      steps: ['খসড়াটি খুলুন।', 'বাকি ধাপগুলো পূরণ করুন।', 'সম্পূর্ণ হিসেবে চিহ্নিত করুন।'],
      action: 'এসিআর খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { userId: string; count: number; first_id: string; first_staff: string }[] =
      await this.dataSource.query(
        `SELECT a.assessed_by AS "userId", COUNT(*)::int AS count,
                MIN(a.id::text) AS first_id, MIN(a.user_id::text) AS first_staff
         FROM acr_assessments a
         JOIN academic_years y ON y.id = a.academic_year_id AND y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
         JOIN users u ON u.id = a.assessed_by AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         WHERE a.tenant_id = $1 AND a.status = 'INCOMPLETE' AND a.updated_at < $2
         GROUP BY a.assessed_by`,
        [ctx.tenantId, new Date(ctx.now.getTime() - STALE_MS)],
      );
    return rows.map((r) => ({
      dedupeKey: `user:${r.userId}`,
      params: { count: r.count },
      actionUrl: r.count === 1 ? `/staff/${r.first_staff}/acr/${r.first_id}` : '/staff/evaluations',
      recipients: [{ userId: r.userId, role: null }],
    }));
  }
}
