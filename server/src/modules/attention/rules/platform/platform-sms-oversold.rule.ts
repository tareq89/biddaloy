import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { ProviderBalanceReader } from '../../../sms-bundles/stock/provider-balance.reader';
import { SmsAllocationService } from '../../../sms-bundles/stock/sms-allocation.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { PlatformTenantResolver, platformRecipients } from './platform-tenant';

/** [100 D8] Owner notice (red): schools hold more unused SMS than the provider has in stock. */
@AttentionRule()
export class PlatformSmsOversoldRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.sms.oversold');
  readonly messages = {
    en: {
      title: 'More SMS sold than the provider holds',
      why: 'Schools hold {promised} unused SMS but the provider has only {stock}. Some schools will fail to send.',
      steps: ['Open Money › SMS.', 'Buy SMS from the provider now and enter the new balance.'],
      action: 'Open SMS stock',
    },
    bn: {
      title: 'প্রোভাইডারের চেয়ে বেশি এসএমএস বিক্রি হয়েছে',
      why: 'স্কুলগুলোর কাছে {promised}টি অব্যবহৃত এসএমএস, কিন্তু প্রোভাইডারের কাছে আছে মাত্র {stock}টি। কিছু স্কুল পাঠাতে পারবে না।',
      steps: ['টাকা › এসএমএস খুলুন।', 'এখনই প্রোভাইডার থেকে এসএমএস কিনে নতুন ব্যালেন্স লিখুন।'],
      action: 'এসএমএস মজুত খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly platform: PlatformTenantResolver,
    private readonly reader: ProviderBalanceReader,
    private readonly allocation: SmsAllocationService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const pid = await this.platform.resolve();
    if (!pid || ctx.tenantId !== pid) return [];
    // An unknown balance is never "oversold" (D29), same as SmsAllocationService.isOversold.
    const balance = await this.reader.read(ctx.now);
    if (balance.sms === null) return [];
    const promised = await this.allocation.promisedUnused();
    if (promised <= balance.sms) return [];
    const recipients = await platformRecipients(this.dataSource);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'platform:sms-oversold',
        params: { stock: balance.sms, promised },
        actionUrl: '/platform/money/sms',
        recipients,
      },
    ];
  }
}
