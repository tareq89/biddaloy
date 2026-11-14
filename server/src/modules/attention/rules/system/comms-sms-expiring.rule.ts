import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity, UserRole, ModuleKey } from '@biddaloy/shared';
import { SmsCreditService } from '../../../communications/credits/sms-credit.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** [100 D21] Unused SMS expire within 7 days (amber) or 1 day (red). One finding per school, soonest date. */
@AttentionRule({ module: ModuleKey.messaging })
export class CommsSmsExpiringRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('sms.expiring');
  readonly messages = {
    en: {
      title: 'Some SMS will expire soon',
      why: '{remaining} unused SMS expire on {date}. After that they cannot be sent.',
      steps: [
        'Send your messages before that date.',
        'Or open Settings › Communication to buy a new package.',
      ],
      action: 'Open SMS',
    },
    bn: {
      title: 'কিছু এসএমএস শীঘ্রই মেয়াদ শেষ হবে',
      why: '{remaining}টি অব্যবহৃত এসএমএস {date} তারিখে মেয়াদ শেষ হবে। এরপর আর পাঠানো যাবে না।',
      steps: [
        'ওই তারিখের আগে বার্তা পাঠিয়ে নিন।',
        'অথবা সেটিংস › যোগাযোগ খুলে নতুন প্যাকেজ কিনুন।',
      ],
      action: 'এসএমএস খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly credits: SmsCreditService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!(await this.credits.isMetered(ctx.tenantId))) return [];
    const soon = new Date(ctx.now.getTime() + 7 * DAY_MS);
    const lots: { expires_at: Date; remaining: number }[] = await this.dataSource.query(
      `SELECT expires_at, remaining FROM sms_credit_lots
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND remaining > 0
          AND expires_at > $2 AND expires_at <= $3
        ORDER BY expires_at`,
      [ctx.tenantId, ctx.now, soon],
    );
    if (!lots.length) return [];
    const first = new Date(lots[0].expires_at);
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        severity:
          first.getTime() - ctx.now.getTime() <= DAY_MS
            ? AlertSeverity.CRITICAL
            : AlertSeverity.WARNING,
        // Credit that goes on the soonest date only, so the date and the number agree.
        params: {
          remaining: lots
            .filter((l) => new Date(l.expires_at).getTime() === first.getTime())
            .reduce((sum, l) => sum + Number(l.remaining), 0),
          date: first.toLocaleDateString('en-CA', { timeZone: ctx.tz }),
        },
        actionUrl: '/settings?section=communication&smsBuy=1',
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
