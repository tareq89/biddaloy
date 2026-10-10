import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, EMPLOYEE_ROLES, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

@AttentionRule()
export class StaffInvitePendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('staff.invite_pending');
  readonly messages = {
    en: {
      title: '{count} staff have not accepted their invitation',
      why: 'They cannot sign in until they open the invitation link and set a password.',
      steps: [
        'Open Staff.',
        'Find the people marked as invited.',
        'Resend the invitation, or ask them to check their SMS or email.',
      ],
      action: 'Open staff list',
    },
    bn: {
      title: '{count} জন কর্মী এখনো আমন্ত্রণ গ্রহণ করেননি',
      why: 'আমন্ত্রণের লিংক খুলে পাসওয়ার্ড না দেওয়া পর্যন্ত তাঁরা লগইন করতে পারবেন না।',
      steps: [
        'কর্মী তালিকা খুলুন।',
        'যাঁদের পাশে "আমন্ত্রিত" লেখা আছে তাঁদের খুঁজুন।',
        'আবার আমন্ত্রণ পাঠান, অথবা তাঁদের এসএমএস/ইমেইল দেখতে বলুন।',
      ],
      action: 'কর্মী তালিকা খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // Employees with no password whose newest INVITE token is neither consumed nor revoked
    // (deriveInvitationStatus PENDING or EXPIRED).
    const [{ n }]: { n: number }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT ut.user_id)::int AS n
       FROM user_tenants ut
       JOIN users u ON u.id = ut.user_id AND u.deleted_at IS NULL AND u.password_hash IS NULL
       JOIN LATERAL (
         SELECT t.consumed_at, t.revoked_at FROM auth_tokens t
         WHERE t.user_id = ut.user_id AND t.tenant_id = $1 AND t.purpose = 'INVITE'
         ORDER BY t.created_at DESC LIMIT 1) last ON true
       WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])
         AND last.consumed_at IS NULL AND last.revoked_at IS NULL`,
      [ctx.tenantId, EMPLOYEE_ROLES.filter((r) => r !== UserRole.SUPER_ADMIN)],
    );
    if (n === 0) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: { count: n },
        actionUrl: '/staff',
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
