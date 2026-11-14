import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AlertSeverity, alertRuleMeta } from '@biddaloy/shared';
import { ProviderBalanceReader } from '../../../sms-bundles/stock/provider-balance.reader';
import { SmsAllocationService } from '../../../sms-bundles/stock/sms-allocation.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { PlatformTenantResolver, platformRecipients } from './platform-tenant';

/**
 * [100 D8] Owner notice: the provider's SMS stock is close to what schools have bought and not
 * used, or the last stock figure is old. Amber only; "oversold" is the red one.
 */
@AttentionRule({ module: 'core' })
export class PlatformSmsStockLowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.sms.stock_low');
  readonly messages = {
    en: {
      title: 'SMS stock is running low',
      why: 'The last stock figure is {stock} SMS (it may be old; refresh it first) and schools hold {promised} unused. If the refreshed figure is still low, top up before they run out.',
      steps: [
        'Open Money › SMS.',
        'Check the stock figure is current. If it is over a week old, refresh it first.',
        'If stock is really low, buy more SMS from the provider and enter the new balance.',
      ],
      action: 'Open SMS stock',
    },
    bn: {
      title: 'এসএমএস মজুত কমে আসছে',
      why: 'সর্বশেষ মজুতের সংখ্যা {stock}টি এসএমএস (পুরনো হতে পারে, আগে নতুন করে লিখুন), আর স্কুলগুলোর কাছে {promised}টি অব্যবহৃত। নতুন সংখ্যাতেও কম থাকলে শেষ হওয়ার আগে কিনে নিন।',
      steps: [
        'টাকা › এসএমএস খুলুন।',
        'মজুতের সংখ্যাটি হালনাগাদ কি না দেখুন। এক সপ্তাহের পুরনো হলে আগে নতুন করে লিখুন।',
        'মজুত সত্যিই কম হলে প্রোভাইডার থেকে আরও এসএমএস কিনে নতুন ব্যালেন্স লিখুন।',
      ],
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
    const balance = await this.reader.read(ctx.now);
    const promised = await this.allocation.promisedUnused();
    const low = balance.sms !== null && balance.sms * 10 < promised * 11; // below promised + 10%
    // A figure last entered more than a week ago cannot be trusted, so it also raises the notice.
    if (!low && !balance.stale) return [];
    const recipients = await platformRecipients(this.dataSource);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'platform:sms-stock',
        // Amber notice; the catalogue row stays REMINDER for the digest.
        severity: AlertSeverity.WARNING,
        params: { stock: balance.sms ?? 0, promised },
        actionUrl: '/platform/money/sms',
        recipients,
      },
    ];
  }
}
