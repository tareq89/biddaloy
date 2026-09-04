import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SchoolHoliday } from './entities/school-holiday.entity';
import { CreateHolidayDto, QueryHolidayDto, UpdateHolidayDto } from './dto/school-calendar.dto';
import { SchoolsService } from '../schools/schools.service';
import { isWeeklyOff, resolveAttendancePolicy } from '../attendance/attendance-policy.util';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@biddaloy/shared';

/** Refuse a `getWorkingDays` range wider than this many days. An unbounded
 * range is how this endpoint becomes a way to make the server build a
 * million-element array. 400 days comfortably covers one academic year plus
 * slack, with room to spare. */
const MAX_RANGE_DAYS = 400;

/** Epoch day (days since 1970-01-01) for a `'YYYY-MM-DD'` string, computed
 * against UTC midnight. Mirrors `attendance-policy.util.ts`'s `toEpochDay` —
 * duplicated rather than imported because that helper is private to the
 * attendance module and this is an academics-module concern; both must stay
 * in sync with "never use `Date` in a local timezone" for calendar math. */
function toEpochDay(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}

/** The inverse of `toEpochDay` — formats a UTC epoch day back to
 * `'YYYY-MM-DD'` without ever touching `toLocaleDateString` or a
 * local-timezone `Date` method, both of which drift by the server's TZ. */
function epochDayToIso(epochDay: number): string {
  const ms = epochDay * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Working-day math for one tenant: expand a date range into the school days
 * within it, and own CRUD for the `school_holidays` calendar entries that
 * feed that math.
 *
 * This is an academics/calendar concern, not an attendance one — attendance
 * only ever reads `getWorkingDays`/`isNonWorkingDay` (see
 * `SchoolHoliday`'s own docstring). [9.3]'s write path used a private
 * stand-in query before this service existed; [9.4] replaced it with the
 * two methods here so there is exactly one definition of "is this a school
 * day".
 */
@Injectable()
export class SchoolCalendarService {
  constructor(
    @InjectRepository(SchoolHoliday)
    private readonly holidayRepo: Repository<SchoolHoliday>,
    private readonly schoolsService: SchoolsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Every date in `[from, to]` that is a school day for this tenant: the
   * range, minus weekly off days, minus holidays whose
   * `counts_as_working_day` is `false`. Dates are `'YYYY-MM-DD'` strings —
   * never `Date` objects, which drift by timezone.
   *
   * Resolves the tenant's attendance policy itself (via `SchoolsService`)
   * rather than taking it as a parameter, so every caller — [9.3]'s write
   * path, [9.4]'s summary service, and this service's own CRUD — reads the
   * same weekly-off set without re-resolving it themselves.
   */
  async getWorkingDays(input: {
    tenantId: string;
    from: string;
    to: string;
    academicYearId?: string;
  }): Promise<{ dates: string[]; count: number }> {
    const { tenantId, from, to, academicYearId } = input;
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

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);

    const candidates: string[] = [];
    for (let day = fromDay; day <= toDay; day++) {
      const dateIso = epochDayToIso(day);
      if (!isWeeklyOff(dateIso, policy)) {
        candidates.push(dateIso);
      }
    }

    if (candidates.length === 0) {
      return { dates: [], count: 0 };
    }

    const qb = this.holidayRepo
      .createQueryBuilder('h')
      .where('h.tenant_id = :tenantId', { tenantId })
      .andWhere('h.deleted_at IS NULL')
      .andWhere('h.counts_as_working_day = false')
      .andWhere('h.start_date <= :to AND h.end_date >= :from', { to, from });
    if (academicYearId) {
      qb.andWhere('h.academic_year_id = :academicYearId', { academicYearId });
    }
    const holidays = await qb.getMany();

    const removedDays = new Set<string>();
    for (const holiday of holidays) {
      const start = Math.max(toEpochDay(holiday.start_date), fromDay);
      const end = Math.min(toEpochDay(holiday.end_date), toDay);
      for (let day = start; day <= end; day++) {
        removedDays.add(epochDayToIso(day));
      }
    }

    const dates = candidates.filter((dateIso) => !removedDays.has(dateIso));
    return { dates, count: dates.length };
  }

  /** True when this one date is not a school day for the tenant — a
   * weekly-off day, or covered by a holiday with `counts_as_working_day =
   * false`. Used by [9.3]'s write path. Delegates to `getWorkingDays` so
   * there is exactly one definition of "is this a school day" — a
   * single-day range whose only candidate got removed. */
  async isNonWorkingDay(input: { tenantId: string; date: string }): Promise<boolean> {
    const { tenantId, date } = input;
    const { count } = await this.getWorkingDays({ tenantId, from: date, to: date });
    return count === 0;
  }

  async listHolidays(
    query: QueryHolidayDto,
    tenantId: string,
  ): Promise<{
    data: SchoolHoliday[];
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

  async createHoliday(
    dto: CreateHolidayDto,
    tenantId: string,
    userId: string,
  ): Promise<SchoolHoliday> {
    if (dto.end_date < dto.start_date) {
      throw new UnprocessableEntityException({
        message: '"end_date" must not be earlier than "start_date"',
        details: { code: 'SCHOOL_CALENDAR_INVALID_RANGE' },
      });
    }
    const holiday = this.holidayRepo.create({
      tenant_id: tenantId,
      academic_year_id: dto.academic_year_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
      name: dto.name,
      counts_as_working_day: dto.counts_as_working_day ?? false,
    });
    const saved = await this.holidayRepo.save(holiday);
    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'SchoolHoliday',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: null,
      new_values: { ...saved },
    });
    return saved;
  }

  private async findOneOrThrow(id: string, tenantId: string): Promise<SchoolHoliday> {
    const holiday = await this.holidayRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }
    return holiday;
  }

  async updateHoliday(
    id: string,
    dto: UpdateHolidayDto,
    tenantId: string,
    userId: string,
  ): Promise<SchoolHoliday> {
    const holiday = await this.findOneOrThrow(id, tenantId);
    const oldValues = { ...holiday };
    const nextStart = dto.start_date ?? holiday.start_date;
    const nextEnd = dto.end_date ?? holiday.end_date;
    if (nextEnd < nextStart) {
      throw new UnprocessableEntityException({
        message: '"end_date" must not be earlier than "start_date"',
        details: { code: 'SCHOOL_CALENDAR_INVALID_RANGE' },
      });
    }
    Object.assign(holiday, dto);
    const saved = await this.holidayRepo.save(holiday);
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'SchoolHoliday',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: oldValues,
      new_values: { ...saved },
    });
    return saved;
  }

  async removeHoliday(id: string, tenantId: string, userId: string): Promise<SchoolHoliday> {
    const holiday = await this.findOneOrThrow(id, tenantId);
    await this.holidayRepo.softDelete({ id, tenant_id: tenantId });
    await this.auditService.record({
      action: AuditAction.DELETE,
      entity_type: 'SchoolHoliday',
      entity_id: holiday.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: { ...holiday },
      new_values: null,
    });
    return holiday;
  }
}
