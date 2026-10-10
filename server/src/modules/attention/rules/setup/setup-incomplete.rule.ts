import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { OnboardingService } from '../../../onboarding/onboarding.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

@AttentionRule()
export class SetupIncompleteRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('setup.incomplete');
  readonly messages = {
    en: {
      title: 'School setup is not finished',
      why: "{done} of {total} setup steps are done. Staff and families can't use everything until setup is complete.",
      steps: [
        'Open the setup wizard.',
        'Finish every step that is not ticked.',
        'Finish the last step of the wizard.',
      ],
      action: 'Continue setup',
    },
    bn: {
      title: 'স্কুলের সেটআপ এখনো শেষ হয়নি',
      why: 'সেটআপের {total}টি ধাপের মধ্যে {done}টি হয়েছে। সেটআপ শেষ না হলে শিক্ষক ও অভিভাবকরা সব সুবিধা পাবেন না।',
      steps: [
        'সেটআপ উইজার্ড খুলুন।',
        'যে ধাপগুলোতে টিক নেই সেগুলো শেষ করুন।',
        'উইজার্ডের শেষ ধাপটি সম্পন্ন করুন।',
      ],
      action: 'সেটআপ চালিয়ে যান',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly onboarding: OnboardingService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // userId only drives `seen`, unused here.
    const s = await this.onboarding.getStatus(ctx.tenantId, '');
    if (s.finished_at !== null || s.items.every((i) => i.done)) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: { done: s.items.filter((i) => i.done).length, total: s.items.length },
        actionUrl: '/welcome',
        recipients,
      },
    ];
  }

  private async admins(tenantId: string): Promise<RuleFinding['recipients']> {
    const rows: { userId: string; role: UserRole }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (ut.user_id) ut.user_id AS "userId", ut.role::text AS role
       FROM user_tenants ut
       JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])
       ORDER BY ut.user_id, array_position($2::text[], ut.role::text)`,
      [tenantId, this.meta.roles],
    );
    return rows.map((r) => ({ userId: r.userId, role: r.role }));
  }
}
