import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { PlatformTenantResolver, platformRecipients } from './platform-tenant';

export const PROVIDER_FAILURE_THRESHOLD = 20;

@AttentionRule()
export class PlatformProviderFailuresRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.provider_failures');
  readonly messages = {
    en: {
      title: '{count} messages failed in the last hour',
      why: 'Failures across {schools} schools — an SMS or email provider may be down.',
      steps: [
        "Check the provider's status page.",
        "Look at a failing school's message batches for the error.",
      ],
      action: 'Open schools',
    },
    bn: {
      title: 'গত এক ঘণ্টায় {count}টি বার্তা যায়নি',
      why: '{schools}টি স্কুলে ব্যর্থতা — কোনো এসএমএস বা ইমেইল সেবা বন্ধ থাকতে পারে।',
      steps: [
        'সেবাদাতার স্ট্যাটাস পাতা দেখুন।',
        'কোনো একটি স্কুলের বার্তা-ব্যাচে ত্রুটির কারণ দেখুন।',
      ],
      action: 'স্কুল তালিকা খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly platform: PlatformTenantResolver,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const pid = await this.platform.resolve();
    if (!pid || ctx.tenantId !== pid) return [];
    // ponytail: constant; communication_logs has no (status, updated_at) index — 67.6.04 (#2094) measures this scan, add a partial index if it shows up
    const [row]: { n: number; schools: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n, COUNT(DISTINCT tenant_id)::int AS schools
       FROM communication_logs WHERE status = 'FAILED' AND updated_at >= $1`,
      [new Date(ctx.now.getTime() - 3_600_000)],
    );
    if (!row || row.n < PROVIDER_FAILURE_THRESHOLD) return [];
    const recipients = await platformRecipients(this.dataSource, pid);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'platform:providers',
        params: { count: row.n, schools: row.schools },
        actionUrl: '/schools',
        recipients,
      },
    ];
  }
}
