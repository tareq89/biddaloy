import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolsService } from '../../schools/schools.service';
import { SchoolCalendarService } from '../../calendar/school-calendar.service';
import { localDate } from '../../attendance/attendance-policy.util';
import type { RuleContext } from './rule.types';

/** `HH:mm` of `now` in `tz` (zero-padded 24h, lexicographically comparable). */
export function localTimeHHmm(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

export function addDaysIso(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Wall-clock `dateIso hhmm` in `tz` -> UTC instant.
 * ponytail: one correction pass; exact for fixed-offset zones (Asia/Dhaka), may be an
 * hour off across a DST jump. Loop the correction if a DST tenant ever appears.
 */
export function localDateTimeToUtc(dateIso: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, Number(x.value)]),
  );
  const offsetMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return new Date(guess - offsetMs);
}

export function endOfLocalDay(dateIso: string, tz: string): Date {
  return localDateTimeToUtc(addDaysIso(dateIso, 1), '00:00', tz);
}

function minusMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.max(0, h * 60 + m - mins);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

@Injectable()
export class RuleContextService {
  constructor(
    private readonly schools: SchoolsService,
    private readonly calendar: SchoolCalendarService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async build(tenantId: string, now: Date, actorUserId?: string): Promise<RuleContext> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    const tz = settings.region!.timezone;
    const date = localDate(now, tz);
    return {
      tenantId,
      now,
      tz,
      localDate: date,
      localTime: localTimeHHmm(now, tz),
      isWorkingDay: !(await this.calendar.isNonWorkingDay({ tenantId, date })),
      settings: settings.attention!,
      actorUserId,
    };
  }

  /** Inside [first period start - lead, last period end]; falls back to [dailyAt, eveningAt]. */
  async isWithinSchoolHours(ctx: RuleContext): Promise<boolean> {
    const rows: { start: string | null; end: string | null }[] = await this.dataSource.query(
      `SELECT to_char(min(starts_at),'HH24:MI') AS start, to_char(max(ends_at),'HH24:MI') AS "end"
         FROM period_slots WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const { start, end } = rows[0] ?? { start: null, end: null };
    const [from, to] =
      start && end
        ? [minusMinutes(start, ctx.settings.classStartingLeadMinutes), end]
        : [ctx.settings.dailyAt, ctx.settings.eveningAt];
    return ctx.localTime >= from && ctx.localTime <= to;
  }
}
