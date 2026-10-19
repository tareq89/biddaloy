import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { PlatformTenantResolver, platformRecipients, schoolNames } from './platform-tenant';

const PLATFORM_WARN_DAYS = 14;

@AttentionRule()
export class PlatformSeatsExpiringRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.seats.expiring');
  readonly messages = {
    en: {
      title: '{count} schools have seats expiring or full',
      why: '{schools}. Talk to them about renewing before they go read-only.',
      steps: ['Open Subscriptions.', 'Contact the schools that have not renewed.'],
      action: 'Open subscriptions',
    },
    bn: {
      title: '{count}টি স্কুলের সিট শেষ হচ্ছে বা পূর্ণ',
      why: '{schools}। শুধু-দেখা অবস্থায় যাওয়ার আগে নবায়ন নিয়ে তাদের সাথে কথা বলুন।',
      steps: ['সাবস্ক্রিপশন খুলুন।', 'যারা নবায়ন করেনি তাদের সাথে যোগাযোগ করুন।'],
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
    // Billing started (seat_limit not NULL) and either the last paid day is within 14 days
    // (or past) or every seat is taken.
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT s.name FROM schools s
        CROSS JOIN LATERAL (SELECT count(*) AS n FROM students st
          WHERE st.tenant_id = s.id AND st.deleted_at IS NULL
            AND st.enrollment_status = 'ACTIVE') u
        WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL AND s.id <> $1
          AND s.seat_limit IS NOT NULL
          AND (
            (SELECT max(o.period_end) FROM seat_orders o
              WHERE o.school_id = s.id AND o.status = 'PAID') <= $2::date + $3::int
            OR (u.n > 0 AND u.n >= s.seat_limit)
          )
        ORDER BY s.name`,
      [pid, ctx.localDate, PLATFORM_WARN_DAYS],
    );
    if (!rows.length) return [];
    const recipients = await platformRecipients(this.dataSource, pid);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'platform:seats',
        params: { count: rows.length, schools: schoolNames(rows.map((r) => r.name)) },
        actionUrl: '/subscriptions',
        recipients,
      },
    ];
  }
}
