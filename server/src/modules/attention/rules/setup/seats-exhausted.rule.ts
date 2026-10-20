import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { adminRecipients, seatSnapshot } from './seats-common';

/**
 * CRITICAL when every paid seat is taken (or students outnumber them) inside a paid period, or
 * when students exist and nothing was ever bought. Silent in the free period.
 */
@AttentionRule()
export class SeatsExhaustedRule implements AttentionRuleShape {
  meta = alertRuleMeta('seats.exhausted');
  messages = {
    en: {
      title: 'All seats are in use ({used} of {entitled})',
      why: 'No new student can be added until you buy more seats.',
      steps: ['Open Settings, Seats & billing', 'Buy more seats'],
      action: 'Buy seats',
    },
    bn: {
      title: 'সব সিট ব্যবহার হয়ে গেছে ({entitled}টির মধ্যে {used}টি)',
      why: 'আরও সিট না কেনা পর্যন্ত নতুন শিক্ষার্থী যোগ করা যাবে না।',
      steps: ['সেটিংস, সিট ও বিলিং খুলুন', 'আরও সিট কিনুন'],
      action: 'সিট কিনুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const snap = await seatSnapshot(this.dataSource, ctx.tenantId, ctx.localDate);
    // used > 0: a school with no students and no seats has nothing to buy yet (the idle rule's job).
    if (!snap || snap.free || snap.used === 0 || snap.used < snap.entitled) return [];
    // Once the paid period is over, seats.expiring (CRITICAL, 0 days left) owns the story.
    if (snap.daysLeft <= 0) return [];

    const recipients = await adminRecipients(this.dataSource, ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'seats:exhausted',
        params: { used: snap.used, entitled: snap.entitled },
        actionUrl: '/settings?section=billing',
        severity: AlertSeverity.CRITICAL,
        recipients,
      },
    ];
  }
}
