import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { PlatformTenantResolver, platformRecipients, schoolNames } from './platform-tenant';

const WEEK_MS = 7 * 86_400_000;

@AttentionRule()
export class PlatformTrialsEndingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.trials_ending');
  readonly messages = {
    en: {
      title: '{count} trials end this week',
      why: '{schools}. Talk to them about a plan before they are suspended.',
      steps: ['Open Schools.', 'Extend the trial or help them choose a plan.'],
      action: 'Open schools',
    },
    bn: {
      title: 'এই সপ্তাহে {count}টি ট্রায়াল শেষ হচ্ছে',
      why: '{schools}। বন্ধ হওয়ার আগে তাদের সাথে প্ল্যান নিয়ে কথা বলুন।',
      steps: ['স্কুল তালিকা খুলুন।', 'ট্রায়াল বাড়ান বা প্ল্যান বেছে নিতে সাহায্য করুন।'],
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
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT name FROM schools
       WHERE status = 'ACTIVE' AND deleted_at IS NULL AND trial_ends_at >= $1 AND trial_ends_at < $2
       ORDER BY trial_ends_at`,
      [ctx.now, new Date(ctx.now.getTime() + WEEK_MS)],
    );
    if (!rows.length) return [];
    const recipients = await platformRecipients(this.dataSource, pid);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'platform:trials',
        params: { count: rows.length, schools: schoolNames(rows.map((r) => r.name)) },
        actionUrl: '/schools',
        recipients,
      },
    ];
  }
}
