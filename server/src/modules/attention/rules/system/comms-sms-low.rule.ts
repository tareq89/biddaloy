import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { isAlmostFinished } from '../../../communications/credits/sms-low.util';
import { SmsCreditService } from '../../../communications/credits/sms-credit.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

/**
 * [100 D20] Red notice for ADMINs when SMS is almost finished or has stopped. Clears once a new
 * package lifts the number. The message templates only substitute `{name}`, so one wording covers
 * both states; `params.stopped` (1 at zero) lets the UI pick the "SMS stopped" line.
 */
@AttentionRule()
export class CommsSmsLowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('sms.low');
  readonly messages = {
    en: {
      title: 'SMS is almost finished or has stopped',
      why: '{remaining} SMS are left. When none are left, sending stops and absence notices and reminders do not go out.',
      steps: ['Open Settings › Communication.', 'Choose an SMS package and buy it.'],
      action: 'Buy SMS',
    },
    bn: {
      title: 'এসএমএস প্রায় শেষ বা বন্ধ হয়ে গেছে',
      why: '{remaining}টি এসএমএস বাকি। কিছু না থাকলে পাঠানো বন্ধ হয়ে যায়, অনুপস্থিতির নোটিশ ও রিমাইন্ডার যায় না।',
      steps: ['সেটিংস › যোগাযোগ খুলুন।', 'একটি এসএমএস প্যাকেজ বেছে কিনুন।'],
      action: 'এসএমএস কিনুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly credits: SmsCreditService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // Unmetered schools have no balance to run out of.
    if (!(await this.credits.isMetered(ctx.tenantId))) return [];
    // Unexpired active lots only, the same set the SMS credits page counts.
    const rows: { units_total: number; remaining: number }[] = await this.dataSource.query(
      `SELECT units_total, remaining FROM sms_credit_lots
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > $2)`,
      [ctx.tenantId, ctx.now],
    );
    const activeLots = rows.map((r) => ({ units_total: Number(r.units_total) }));
    const remaining = rows.reduce((sum, r) => sum + Number(r.remaining), 0);
    const { almostFinished, stopped } = isAlmostFinished({ remaining, activeLots });
    if (!almostFinished) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: { remaining, stopped: stopped ? 1 : 0 },
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
