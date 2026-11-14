import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

@AttentionRule({ module: 'core' })
export class SupportAccessRequestRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('support.access_request');
  readonly messages = {
    en: {
      title: '{owner} from Biddaloy asks to open your school as {role}',
      why: 'Nothing opens until an admin approves. The request closes by itself after 24 hours.',
      steps: ['Open the request.', 'Approve it, or deny it.'],
      action: 'Open request',
    },
    bn: {
      title: 'Biddaloy-র {owner} আপনার স্কুল {role} হিসেবে খুলতে চাইছেন',
      why: 'অ্যাডমিন অনুমোদন না দিলে কিছুই খুলবে না। ২৪ ঘণ্টা পরে অনুরোধটি নিজে থেকেই বন্ধ হয়ে যায়।',
      steps: ['অনুরোধটি খুলুন।', 'অনুমোদন দিন, অথবা বাতিল করুন।'],
      action: 'অনুরোধ খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // Mirrors SupportRequestsService IS_ASK; `ctx.now` (not now()) keeps the cut-off testable.
    // Only the owner's first name and the role leave this query: never the reason text.
    const rows: { id: string; owner: string | null; role: string }[] = await this.dataSource.query(
      `SELECT s.id, split_part(btrim(owner.full_name), ' ', 1) AS owner, s.role::text AS role
       FROM impersonation_sessions s
       JOIN users owner ON owner.id = s.platform_admin_id
       WHERE s.tenant_id = $1 AND s.status = 'REQUESTED' AND s.entry_kind = 'NORMAL'
         AND s.requested_at > $2::timestamptz - interval '24 hours'
       ORDER BY s.requested_at`,
      [ctx.tenantId, ctx.now],
    );
    if (!rows.length) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return rows.map((r) => ({
      dedupeKey: 'support:request:' + r.id,
      subject: { type: 'support_request', id: r.id },
      params: { owner: r.owner ?? '', role: r.role },
      actionUrl: '/support-access/requests/' + r.id,
      recipients,
    }));
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
