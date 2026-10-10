import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { SchoolsService } from '../../../schools/schools.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

@AttentionRule()
export class CommsProviderMissingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('comms.provider_missing');
  readonly messages = {
    en: {
      title: 'SMS and email are not set up',
      why: 'The school cannot send any SMS or email — absence notices, fee reminders and invitations will not go out.',
      steps: [
        'Open Settings › Communication.',
        'Fill in the SMS gateway or the email (SMTP) details.',
        'Press Save.',
      ],
      action: 'Open communication settings',
    },
    bn: {
      title: 'এসএমএস ও ইমেইল চালু করা হয়নি',
      why: 'স্কুল থেকে কোনো এসএমএস বা ইমেইল যাচ্ছে না — অনুপস্থিতির নোটিশ, ফি রিমাইন্ডার ও আমন্ত্রণ পৌঁছাবে না।',
      steps: [
        'সেটিংস › যোগাযোগ খুলুন।',
        'এসএমএস গেটওয়ে বা ইমেইল (SMTP)-এর তথ্য দিন।',
        'সংরক্ষণ করুন চাপুন।',
      ],
      action: 'যোগাযোগ সেটিংস খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const c = (await this.schools.getResolvedSettings(ctx.tenantId)).communications;
    if (c?.sms || c?.email) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: {},
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
