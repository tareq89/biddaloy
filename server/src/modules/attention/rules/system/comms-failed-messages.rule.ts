import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

@AttentionRule()
export class CommsFailedMessagesRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('comms.failed_messages');
  readonly messages = {
    en: {
      title: '{count} messages failed in the last 24 hours',
      why: 'Some SMS or emails did not reach parents or staff. The gateway may be down or its settings may be wrong.',
      steps: [
        'Open Communications › Batches.',
        'Look at the failed messages and their error.',
        'Fix the gateway settings, then send again.',
      ],
      action: 'See failed messages',
    },
    bn: {
      title: 'গত ২৪ ঘণ্টায় {count}টি বার্তা পাঠানো যায়নি',
      why: 'কিছু এসএমএস বা ইমেইল অভিভাবক বা কর্মীদের কাছে পৌঁছায়নি। গেটওয়ে বন্ধ থাকতে পারে বা সেটিংসে ভুল থাকতে পারে।',
      steps: [
        'যোগাযোগ › ব্যাচ খুলুন।',
        'যেসব বার্তা যায়নি সেগুলো ও তার কারণ দেখুন।',
        'গেটওয়ের সেটিংস ঠিক করে আবার পাঠান।',
      ],
      action: 'ব্যর্থ বার্তা দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [{ n }]: { n: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM communication_logs
       WHERE tenant_id = $1 AND status = 'FAILED' AND updated_at >= $2`,
      [ctx.tenantId, new Date(ctx.now.getTime() - 24 * 3600_000)],
    );
    if (n < ctx.settings.failedMessagesThreshold) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: { count: n },
        actionUrl: '/communications/batches',
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
