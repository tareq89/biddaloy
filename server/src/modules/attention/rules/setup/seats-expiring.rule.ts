import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { adminRecipients, seatSnapshot } from './seats-common';

export const SEATS_WARN_DAYS = 30;
export const SEATS_URGENT_DAYS = 7;
const NEAR_FULL = 0.9;

/**
 * WARNING 30 days before the paid seats run out (or at 90 % used), CRITICAL from 7 days.
 * Silent in the free period (`seat_limit` NULL) and for a school that never bought seats.
 * A full school (used >= entitled) is `seats.exhausted`'s business, not this rule's.
 */
@AttentionRule()
export class SeatsExpiringRule implements AttentionRuleShape {
  meta = alertRuleMeta('seats.expiring');
  messages = {
    en: {
      // Count last, so 1 and 0 days read right without plural forms.
      title: 'Seats run out soon. Days left: {days}',
      why: '{used} of {entitled} seats are in use. Seats are paid until {date}. After that the school is read-only, then paused.',
      steps: ['Open Settings, Seats & billing', 'Buy seats for the next period'],
      action: 'Buy seats',
    },
    bn: {
      title: 'সিট শেষ হয়ে আসছে। বাকি দিন: {days}',
      why: '{entitled}টির মধ্যে {used}টি সিট ব্যবহার হচ্ছে। সিট {date} পর্যন্ত পরিশোধিত। এরপর স্কুল শুধু দেখা যাবে, তারপর বন্ধ হয়ে যাবে।',
      steps: ['সেটিংস, সিট ও বিলিং খুলুন', 'পরবর্তী সময়ের জন্য সিট কিনুন'],
      action: 'সিট কিনুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const snap = await seatSnapshot(this.dataSource, ctx.tenantId, ctx.localDate);
    if (!snap || snap.periodEnd === null || snap.daysLeft === null) return [];

    // Full schools show `seats.exhausted`; one bar per problem.
    if (snap.entitled > 0 && snap.used >= snap.entitled) return [];
    const near = snap.daysLeft <= SEATS_WARN_DAYS;
    const fullish = snap.entitled > 0 && snap.used >= snap.entitled * NEAR_FULL;
    if (!near && !fullish) return [];

    const recipients = await adminRecipients(this.dataSource, ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `seats:${snap.periodEnd}`,
        params: {
          days: Math.max(snap.daysLeft, 0),
          used: snap.used,
          entitled: snap.entitled,
          date: snap.periodEnd,
        },
        actionUrl: '/settings?section=billing',
        severity:
          snap.daysLeft <= SEATS_URGENT_DAYS ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        recipients,
      },
    ];
  }
}
