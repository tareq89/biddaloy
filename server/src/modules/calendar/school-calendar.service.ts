import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { QueryHolidayDto } from './dto/working-days.dto';
import { SchoolsService } from '../schools/schools.service';
import { isWeeklyOff, resolveAttendancePolicy } from '../attendance/attendance-policy.util';
import { CalendarEventType } from '@biddaloy/shared';

/** Refuse to compute `getWorkingDays` for a range wider than this many days.
 * An unbounded range is how this endpoint becomes a way to make the server
 * build a million-element array. 400 days comfortably covers one academic
 * year plus slack, with room to spare. */
const MAX_RANGE_DAYS = 400;

/** Epoch day (days since 1970-01-01) for a `'YYYY-MM-DD'` string, computed
 * against UTC midnight. Mirrors `attendance-policy.util.ts`'s `toEpochDay` —
 * duplicated rather than imported because the helper is private to each
 * module's own calendar math; both must stay in sync with "never use
 * `Date` in local timezone" for calendar math. */
function toEpochDay(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}

/** The inverse of `toEpochDay` — formats a UTC epoch day back into a
 * `'YYYY-MM-DD'` string without ever touching `toLocaleDateString` or any
 * other local-timezone `Date` method, both of which drift by the server's
 * TZ. */
function epochDayToIso(epochDay: number): string {
  const ms = epochDay * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Working-day math and holiday CRUD, moved verbatim from
 * `academics/school-calendar.service.ts` in [17.1.2] — an academics/calendar
 * concern, not an attendance one: attendance only ever reads
 * `getWorkingDays`/`isNonWorkingDay` (see `CalendarEvent`'s own docstring).
 * [9.3]'s write path used a private stand-in query before this service
 * existed; [9.4] replaced it so there is exactly one definition of "is this
 * a school day".
 */
/** 422 when `to < from` or the range is wider than `MAX_RANGE_DAYS`. Exported
 * so a caller that may return early (`ResolveRoutineService`) rejects a bad
 * range the same way whether or not it ever reaches `getWorkingDays`. */
export function assertWorkingDaysRange(
  from: string,
  to: string,
): { fromDay: number; toDay: number } {
  const fromDay = toEpochDay(from);
  const toDay = toEpochDay(to);
  if (toDay < fromDay) {
    throw new UnprocessableEntityException({
      message: '"to" must not be earlier than "from"',
      details: { code: 'SCHOOL_CALENDAR_INVALID_RANGE' },
    });
  }
  if (toDay - fromDay + 1 > MAX_RANGE_DAYS) {
    throw new UnprocessableEntityException({
      message: `Range must not exceed ${MAX_RANGE_DAYS} days`,
      details: { code: 'SCHOOL_CALENDAR_RANGE_TOO_WIDE' },
    });
  }
  return { fromDay, toDay };
}

@Injectable()
export class SchoolCalendarService {
  constructor(
    @InjectRepository(CalendarEvent)
    private readonly holidayRepo: Repository<CalendarEvent>,
    private readonly schoolsService: SchoolsService,
  ) {}

  /**
   * Every date in `[from, to]` that is a school day for the tenant: every
   * date in the range, minus weekly off days, minus published holidays
   * whose `counts_as_working_day` is `false`. Dates are `'YYYY-MM-DD'`
   * strings — never `Date` objects, which drift by timezone.
   *
   * Resolves the tenant's attendance policy itself (via `SchoolsService`)
   * rather than taking it as a parameter, so every caller — [9.3]'s write
   * path, [9.4]'s summary service, and this service's own CRUD reads — use
   * the same weekly-off set without re-resolving it themselves.
   */
  async getWorkingDays(input: {
    tenantId: string;
    from: string;
    to: string;
    academicYearId?: string;
    /** D25: with a class, an event counts when school-wide or scoped to it;
     * without one, only school-wide events count. */
    classId?: string;
  }): Promise<{ dates: string[]; count: number }> {
    const { tenantId, from, to, academicYearId, classId } = input;
    const { fromDay, toDay } = assertWorkingDaysRange(from, to);

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);

    const candidateSet = new Set<string>();
    for (let day = fromDay; day <= toDay; day++) {
      const dateIso = epochDayToIso(day);
      if (!isWeeklyOff(dateIso, policy)) {
        candidateSet.add(dateIso);
      }
    }

    const scoped = (extra = '') =>
      `EXISTS (SELECT 1 FROM calendar_event_classes ec WHERE ec.event_id = h.id AND ec.tenant_id = :tenantId${extra})`;
    // Published events of one kind that overlap [from, to], within the
    // tenant, year and class scope (D25) — shared by the add-back and the
    // subtraction below so the two can never disagree about scope.
    const publishedEvents = (condition: string, params: Record<string, string>) => {
      const qb = this.holidayRepo
        .createQueryBuilder('h')
        .where('h.tenant_id = :tenantId', { tenantId })
        .andWhere('h.deleted_at IS NULL')
        // [17.1.2] D9: a draft (published_at IS NULL) never affects
        // working-day math — only a published one does.
        .andWhere('h.published_at IS NOT NULL')
        .andWhere(condition, params)
        .andWhere('h.start_date <= :to AND h.end_date >= :from', { to, from });
      if (academicYearId) {
        qb.andWhere('h.academic_year_id = :academicYearId', { academicYearId });
      }
      if (classId) {
        qb.andWhere(`(NOT ${scoped()} OR ${scoped(' AND ec.class_id = :classId')})`, { classId });
      } else {
        qb.andWhere(`NOT ${scoped()}`);
      }
      return qb.getMany();
    };
    const datesOf = (events: CalendarEvent[]): string[] => {
      const out: string[] = [];
      for (const event of events) {
        const start = Math.max(toEpochDay(event.start_date), fromDay);
        const end = Math.min(toEpochDay(event.end_date), toDay);
        for (let day = start; day <= end; day++) {
          out.push(epochDayToIso(day));
        }
      }
      return out;
    };

    // [68.3.15.01] TIME-05: a published MAKEUP_DAY turns a weekly off-day
    // into a school day. Added before the holiday subtraction, so a
    // holiday on the same date still wins.
    const makeups = await publishedEvents('h.type = :makeup', {
      makeup: CalendarEventType.MAKEUP_DAY,
    });
    for (const dateIso of datesOf(makeups)) {
      candidateSet.add(dateIso);
    }
    const candidates = [...candidateSet].sort();
    if (candidates.length === 0) {
      return { dates: [], count: 0 };
    }

    const holidays = await publishedEvents('h.counts_as_working_day = false', {});
    const removedDays = new Set(datesOf(holidays));

    const dates = candidates.filter((dateIso) => !removedDays.has(dateIso));
    return { dates, count: dates.length };
  }

  /** True if a single date is not a school day for the tenant — either a
   * weekly-off day, or covered by a holiday with `counts_as_working_day =
   * false`. Used by [9.3]'s write path. Delegates to `getWorkingDays` so
   * there is exactly one definition of "is this a school day", with a
   * single-day range checking only whether the candidate got removed. */
  async isNonWorkingDay(input: {
    tenantId: string;
    date: string;
    classId?: string;
  }): Promise<boolean> {
    const { tenantId, date, classId } = input;
    const { count } = await this.getWorkingDays({ tenantId, from: date, to: date, classId });
    return count === 0;
  }

  async listHolidays(
    query: QueryHolidayDto,
    tenantId: string,
  ): Promise<{
    data: CalendarEvent[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 10;

    const qb = this.holidayRepo
      .createQueryBuilder('h')
      .where('h.tenant_id = :tenantId', { tenantId })
      .andWhere('h.deleted_at IS NULL');
    if (query.academic_year_id) {
      qb.andWhere('h.academic_year_id = :academicYearId', {
        academicYearId: query.academic_year_id,
      });
    }
    if (query.from) {
      qb.andWhere('h.end_date >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('h.start_date <= :to', { to: query.to });
    }

    const [data, total] = await qb
      .orderBy('h.start_date', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 0 };
  }
}
