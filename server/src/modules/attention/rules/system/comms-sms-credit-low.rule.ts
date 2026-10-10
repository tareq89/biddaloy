import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { SmsCreditService } from '../../../communications/credits/sms-credit.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

@AttentionRule()
export class CommsSmsCreditLowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('comms.sms_credit_low');
  readonly messages = {
    en: {
      title: 'SMS credit is running low',
      why: 'Only {available} SMS credits are left (warning level {threshold}). When they run out, absence notices and reminders stop.',
      steps: [
        'Open Settings › Communication.',
        'Check the credit balance.',
        'Contact the platform team to buy more credit.',
      ],
      action: 'Open SMS credit',
    },
    bn: {
      title: 'এসএমএস ক্রেডিট প্রায় শেষ',
      why: 'মাত্র {available}টি এসএমএস ক্রেডিট বাকি (সতর্কসীমা {threshold})। শেষ হয়ে গেলে অনুপস্থিতির নোটিশ ও রিমাইন্ডার যাওয়া বন্ধ হবে।',
      steps: [
        'সেটিংস › যোগাযোগ খুলুন।',
        'ক্রেডিটের হিসাব দেখুন।',
        'আরও ক্রেডিট কিনতে প্ল্যাটফর্ম টিমের সাথে যোগাযোগ করুন।',
      ],
      action: 'এসএমএস ক্রেডিট দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly credits: SmsCreditService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // Unmetered schools have no balance to run out of.
    if (!(await this.credits.isMetered(ctx.tenantId))) return [];
    // `available` is what can still be spent; `reserved` is already set aside.
    const { available } = await this.credits.getBalance(ctx.tenantId);
    const threshold = ctx.settings.smsCreditLowThreshold;
    if (available >= threshold) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: { available, threshold },
        actionUrl: '/settings?section=communication',
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
