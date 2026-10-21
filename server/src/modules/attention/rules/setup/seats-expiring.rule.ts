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
 * WARNING 30 days before the seats run out (or at 90 % used), CRITICAL from 7 days. A school
 * that never paid counts down to `BILLING_FREE_UNTIL`. An order of 31 days or less gets no
 * 30-day warning (it would show on the day it was paid), only the 7-day one.
 * A full school (used >= entitled) is `seats.exhausted`'s business, not this rule's.
 */
@AttentionRule()
export class SeatsExpiringRule implements AttentionRuleShape {
  meta = alertRuleMeta('seats.expiring');
  messages = {
    en: {
      // Count last, so 1 and 0 days read right without plural forms.
      title: 'Seats run out soon. Days left: {days}',
      why: '{used} of {entitled} paid seats are in use. Seats are covered until {date}. After that, if the school has students, it is read-only for 7 days, then paused.',
      steps: ['Open Settings, Seats & billing', 'Buy seats for the next period'],
      action: 'Buy seats',
    },
    bn: {
      title: 'সিট শেষ হয়ে আসছে। বাকি দিন: {days}',
      why: '{entitled}টি পরিশোধিত সিটের মধ্যে {used}টি ব্যবহার হচ্ছে। সিট {date} পর্যন্ত চালু। এরপর স্কুলে শিক্ষার্থী থাকলে ৭ দিন শুধু দেখা যাবে, তারপর বন্ধ হয়ে যাবে।',
      steps: ['সেটিংস, সিট ও বিলিং খুলুন', 'পরবর্তী সময়ের জন্য সিট কিনুন'],
      action: 'সিট কিনুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const snap = await seatSnapshot(this.dataSource, ctx.tenantId, ctx.localDate);
    if (!snap) return [];

    // Full schools show `seats.exhausted`; one bar per problem.
    if (snap.entitled > 0 && snap.used >= snap.entitled) return [];
    const near = snap.daysLeft <= (snap.shortPeriod ? SEATS_URGENT_DAYS : SEATS_WARN_DAYS);
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
