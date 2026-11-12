import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { IMPERSONATION_RATE_LIMIT } from '../../../support-access/sessions/impersonation-session.service';
import { PlatformTenantResolver } from './platform-tenant';

@AttentionRule()
export class PlatformLoginAsBurstRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.login_as_burst');
  readonly messages = {
    en: {
      title: '{owner} started Login as {count} times in the last hour',
      why: 'That is the hourly limit. Check that the access was needed.',
      steps: ['Open the Login as list.', 'Ask {owner} why, if it looks wrong.'],
      action: 'Open list',
    },
    bn: {
      title: '{owner} গত এক ঘণ্টায় {count} বার "স্কুল হিসেবে প্রবেশ" শুরু করেছেন',
      why: 'এটাই ঘণ্টাপ্রতি সীমা। প্রবেশটি সত্যিই দরকার ছিল কি না দেখুন।',
      steps: ['"স্কুল হিসেবে প্রবেশ" তালিকা খুলুন।', 'সন্দেহ হলে {owner}-কে কারণ জিজ্ঞাসা করুন।'],
      action: 'তালিকা খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly platform: PlatformTenantResolver,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const pid = await this.platform.resolve();
    if (!pid || ctx.tenantId !== pid) return [];
    // Cross-school on purpose (every school's sessions count toward the owner's limit).
    // Only the owner's first name and a count leave this query.
    const bursts: { ownerId: string; owner: string | null; n: number }[] =
      await this.dataSource.query(
        `SELECT s.platform_admin_id AS "ownerId",
                split_part(btrim(u.full_name), ' ', 1) AS owner, count(*)::int AS n
         FROM impersonation_sessions s
         JOIN users u ON u.id = s.platform_admin_id
         WHERE s.created_at > $1::timestamptz - interval '1 hour'
         GROUP BY s.platform_admin_id, u.full_name
         HAVING count(*) >= $2
         ORDER BY s.platform_admin_id`,
        [ctx.now, IMPERSONATION_RATE_LIMIT],
      );
    const findings: RuleFinding[] = [];
    for (const b of bursts) {
      const recipients = await this.otherOwners(pid, b.ownerId);
      if (!recipients.length) continue;
      findings.push({
        dedupeKey: 'platform:login_as_burst:' + b.ownerId,
        subject: { type: 'platform_admin', id: b.ownerId },
        params: { owner: b.owner ?? '', count: b.n },
        actionUrl: '/schools',
        recipients,
      });
    }
    return findings;
  }

  /** Active, unlocked platform owners except the one who caused the burst. */
  private async otherOwners(pid: string, exceptId: string): Promise<RuleFinding['recipients']> {
    const rows: { userId: string }[] = await this.dataSource.query(
      `SELECT ut.user_id AS "userId" FROM user_tenants ut
       JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       JOIN platform_admins pa ON pa.user_id = ut.user_id AND pa.locked_at IS NULL
       WHERE ut.tenant_id = $1 AND ut.role = 'SUPER_ADMIN' AND ut.deleted_at IS NULL
         AND ut.user_id <> $2`,
      [pid, exceptId],
    );
    return rows.map((r) => ({ userId: r.userId, role: UserRole.SUPER_ADMIN }));
  }
}
