import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import { addDaysIso, localDateTimeToUtc } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

/** Runs at `eveningAt`: `EVENING_RULE_KEYS` decides that, no time gate here. */
@AttentionRule()
export class CalendarHolidayTomorrowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('calendar.holiday_tomorrow');
  readonly messages = {
    en: {
      title: 'Tomorrow is a holiday: {name}',
      why: 'The school is closed until {until}.',
      steps: ['Check the calendar for the full list of days off.'],
      action: 'Open calendar',
    },
    bn: {
      title: 'আগামীকাল ছুটি: {name}',
      why: '{until} পর্যন্ত স্কুল বন্ধ থাকবে।',
      steps: ['সব ছুটির দিন দেখতে ক্যালেন্ডার খুলুন।'],
      action: 'ক্যালেন্ডার খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const tomorrow = addDaysIso(ctx.localDate, 1);
    // Same filters as SchoolCalendarService.getWorkingDays, school-wide branch.
    // Announce on the evening before a holiday starts. Inside a long break that is not news again,
    // unless the event was published or changed since yesterday's evening run: a same-day closure,
    // or a break extended past its first end date.
    // ponytail: class-scoped holidays skipped, add per-class audiences when a school asks.
    const lastRun = localDateTimeToUtc(
      addDaysIso(ctx.localDate, -1),
      ctx.settings.eveningAt,
      ctx.tz,
    );
    const events: { id: string; name: string; audience: string; end_date: string }[] =
      await this.dataSource.query(
        `SELECT h.id, h.name, h.audience::text AS audience, to_char(h.end_date, 'YYYY-MM-DD') AS end_date
         FROM calendar_events h
         WHERE h.tenant_id = $1 AND h.deleted_at IS NULL AND h.published_at IS NOT NULL
           AND h.counts_as_working_day = false AND h.start_date <= $2 AND h.end_date >= $2
           AND (h.start_date = $2 OR GREATEST(h.updated_at, h.published_at) > $3)
           AND NOT EXISTS (SELECT 1 FROM calendar_event_classes ec WHERE ec.event_id = h.id AND ec.tenant_id = $1)`,
        [ctx.tenantId, tomorrow, lastRun],
      );
    if (!events.length) return [];

    const staffRoles = this.meta.roles.filter(
      (r) => r !== UserRole.PARENT && r !== UserRole.STUDENT,
    );
    const staff = await roleRecipients(this.dataSource, ctx.tenantId, staffRoles);
    // STAFF-audience events are never shown to families (calendar-visibility.util).
    const family = events.some((e) => e.audience === 'ALL')
      ? await roleRecipients(this.dataSource, ctx.tenantId, [UserRole.PARENT, UserRole.STUDENT])
      : [];

    const expiresAt = localDateTimeToUtc(tomorrow, '00:00', ctx.tz);
    const finding = (
      e: (typeof events)[number],
      side: 'staff' | 'family',
      recipients: RuleFinding['recipients'],
      actionUrl: string,
    ): RuleFinding => ({
      dedupeKey: `calendar_event:${e.id}:${tomorrow}:${side}`,
      subject: { type: 'calendar_event', id: e.id },
      params: { name: e.name, until: e.end_date },
      actionUrl,
      expiresAt,
      recipients,
    });
    const out: RuleFinding[] = [];
    for (const e of events) {
      if (staff.length) out.push(finding(e, 'staff', staff, '/calendar'));
      if (e.audience === 'ALL' && family.length) {
        out.push(finding(e, 'family', family, '/portal/calendar'));
      }
    }
    return out;
  }
}
