import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { PlatformHomeService } from '../../../platform-identity/platform-home.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { platformAdminRecipients } from './platform-admin-recipients';

/** An owner with a confirmed authenticator and two or fewer unused recovery codes is told, alone. */
export const RECOVERY_CODES_LOW_AT = 2;

@AttentionRule()
export class PlatformRecoveryCodesLowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.recovery_codes_low');
  readonly messages = {
    en: {
      title: 'Only {count} recovery codes left',
      why: 'Recovery codes let you sign in if you lose your authenticator. You have {count} left.',
      steps: ['Open Owner security.', 'Make a new set of recovery codes and store them safely.'],
      action: 'Open owner security',
    },
    bn: {
      title: 'রিকভারি কোড আছে মাত্র {count}টি',
      why: 'অথেন্টিকেটর হারালে রিকভারি কোড দিয়ে সাইন-ইন করা যায়। আপনার আর {count}টি বাকি আছে।',
      steps: ['মালিকের নিরাপত্তা পাতা খুলুন।', 'নতুন রিকভারি কোড তৈরি করে নিরাপদ জায়গায় রাখুন।'],
      action: 'মালিকের নিরাপত্তা খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly home: PlatformHomeService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // The sweep visits every school; only the platform home school's run produces findings.
    const homeId = await this.home.id();
    if (!homeId || ctx.tenantId !== homeId) return [];
    const owners = await platformAdminRecipients(this.dataSource);
    if (!owners.length) return [];

    const rows: { userId: string; left: number }[] = await this.dataSource.query(
      `SELECT m.user_id AS "userId",
              (SELECT count(*)::int FROM user_recovery_codes rc
                WHERE rc.user_id = m.user_id AND rc.used_at IS NULL) AS "left"
         FROM user_mfa m
        WHERE m.confirmed_at IS NOT NULL AND m.user_id = ANY($1::uuid[])`,
      [owners.map((o) => o.userId)],
    );
    return rows
      .filter((r) => r.left <= RECOVERY_CODES_LOW_AT)
      .map((r) => ({
        dedupeKey: `platform:recovery:${r.userId}`,
        params: { count: r.left },
        actionUrl: '/owner-security',
        recipients: owners.filter((o) => o.userId === r.userId),
      }));
  }
}
