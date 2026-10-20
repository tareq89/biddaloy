import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { PlatformTenantResolver, platformRecipients, schoolNames } from './platform-tenant';

/**
 * bKash took money that paid no order (amount mismatch, or the order was already settled):
 * `BkashService` records it as an orphan `platform_payments` row. It stays on this alert until the
 * operator refunds it and stamps `raw.refunded_at` (28-billing.md, "Money bKash took for nothing").
 */
@AttentionRule()
export class PlatformBkashRefundDueRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.bkash.refund_due');
  readonly messages = {
    en: {
      title: '{count} bKash payments need a refund',
      why: 'bKash took the money but no order was paid (trxID {refs}; {schools}).',
      steps: [
        'Refund each trxID from the bKash merchant panel.',
        'Then mark it refunded as 28-billing.md shows.',
      ],
      action: 'Open subscriptions',
    },
    bn: {
      title: '{count}টি বিকাশ পেমেন্টের টাকা ফেরত দিতে হবে',
      why: 'বিকাশ টাকা নিয়েছে কিন্তু কোনো অর্ডার পরিশোধ হয়নি (trxID {refs}; {schools})।',
      steps: [
        'বিকাশ মার্চেন্ট প্যানেল থেকে প্রতিটি trxID-এর টাকা ফেরত দিন।',
        'তারপর 28-billing.md অনুযায়ী ফেরত দেওয়া হয়েছে বলে চিহ্ন দিন।',
      ],
      action: 'সাবস্ক্রিপশন খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly platform: PlatformTenantResolver,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const pid = await this.platform.resolve();
    if (!pid || ctx.tenantId !== pid) return [];
    // ponytail: no index on raw; platform_payments is one row per paid order, so the scan is small. Add a partial index if it ever shows up.
    const rows: { ref: string; name: string }[] = await this.dataSource.query(
      `SELECT p.gateway_ref AS ref, s.name FROM platform_payments p
         JOIN seat_orders o ON o.id = p.seat_order_id
         JOIN schools s ON s.id = o.school_id
        WHERE p.raw->>'orphan' = 'true' AND p.raw->>'refunded_at' IS NULL
        ORDER BY p.created_at`,
    );
    if (!rows.length) return [];
    const recipients = await platformRecipients(this.dataSource, pid);
    if (!recipients.length) return [];
    const refs = rows.slice(0, 3).map((r) => r.ref);
    return [
      {
        dedupeKey: 'platform:bkash-refund',
        params: {
          count: rows.length,
          refs: refs.join(', ') + (rows.length > 3 ? ' …' : ''),
          schools: schoolNames([...new Set(rows.map((r) => r.name))]),
        },
        actionUrl: '/subscriptions',
        recipients,
      },
    ];
  }
}
