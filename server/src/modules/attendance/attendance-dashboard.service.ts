import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import {
  AttendanceSessionState,
  AttendanceStatus,
  DashboardWidgetKey,
  EnrollmentStatus,
  StudentLifecycleEventType,
  TeacherAssignmentType,
} from '@biddaloy/shared';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceService } from './attendance.service';
import {
  AttendanceSummaryService,
  computeAttendancePercentage,
} from './attendance-summary.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { localToday, resolveAttendancePolicy } from './attendance-policy.util';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { SchoolsService } from '../schools/schools.service';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { DEFAULT_REGION_SETTINGS } from '../schools/settings/tenant-settings-defaults';
import type {
  CommitteeAttendanceDto,
  CommitteeAttendanceMonthDto,
} from './dto/committee-attendance.dto';
import type {
  AttendanceSeriesPointDto,
  AttendanceTodayWidgetDto,
  ClassTeacherStreaksDto,
  MyPendingSectionsDto,
} from './dto/attendance-dashboard.dto';

export const ATTENDANCE_SERIES_DAYS = 30;
/** 36 h: the nightly job rewrites it at 00:15, so one missed night still serves. */
export const ATTENDANCE_SERIES_TTL_SECONDS = 36 * 60 * 60;

type Policy = ReturnType<typeof resolveAttendancePolicy>;
type Tally = { present: number; late: number; absent: number; leave: number };
export type DayTally = Tally & { date: string };

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function percentageOf(c: Tally, policy: Policy): number | null {
  const marked = c.present + c.late + c.absent + c.leave;
  return computeAttendancePercentage(
    {
      present_days: c.present,
      late_days: c.late,
      absent_days: c.absent,
      leave_days: c.leave,
      working_days: marked,
      marked_days: marked,
    },
    policy,
  );
}

/**
 * "Student attendance today" dashboard widget. Today's figures fold
 * `AttendanceService.listMySections` (so they equal the register screens);
 * the 30-day series is the one heavy query, precomputed nightly.
 */
@Injectable()
export class AttendanceDashboardService {
  private readonly logger = new Logger(AttendanceDashboardService.name);

  constructor(
    @InjectRepository(AttendanceRecord) private readonly recordRepo: Repository<AttendanceRecord>,
    private readonly attendanceService: AttendanceService,
    private readonly summaryService: AttendanceSummaryService,
    private readonly teacherScope: TeacherScopeService,
    private readonly schoolsService: SchoolsService,
    private readonly cache: DashboardCacheService,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
  ) {}

  seriesKey(tenantId: string, to: string): string {
    return `tenant:${tenantId}:dash:${DashboardWidgetKey.ATTENDANCE_TODAY}:series:${to}`;
  }

  getToday(tenantId: string, role: string, userId: string): Promise<AttendanceTodayWidgetDto> {
    return this.cache.getOrLoad(tenantId, DashboardWidgetKey.ATTENDANCE_TODAY, 'school', () =>
      this.load(tenantId, role, userId),
    );
  }

  /** Teacher card "হাজিরা নেওয়া বাকি": today's marking state of every section the caller may mark. */
  myPendingSections(tenantId: string, role: string, userId: string): Promise<MyPendingSectionsDto> {
    return this.cache.getOrLoad(
      tenantId,
      DashboardWidgetKey.MY_PENDING_SECTIONS,
      `user:${userId}`,
      async () => {
        const date = await this.schoolsService.todayFor(tenantId);
        const rows = await this.attendanceService.listMySections({ role, userId, tenantId, date });
        const sections = rows
          .map((r) => ({
            section_id: r.section_id,
            class_name: r.class_name,
            section_name: r.section_name,
            student_count: r.student_count,
            taken: r.today?.state === AttendanceSessionState.FINALIZED,
            unmarked: r.today?.unmarked ?? r.student_count,
          }))
          // Not taken first, then class / section (stable, so listMySections order breaks ties).
          .sort((a, b) => Number(a.taken) - Number(b.taken));
        return {
          date,
          is_working_day: rows.length === 0 || rows.some((r) => r.is_working_day),
          pending_count: sections.filter((s) => !s.taken).length,
          sections,
        };
      },
    );
  }

  /** Teacher card "আমার ক্লাস — টানা অনুপস্থিত": absent runs in the caller's own homeroom section. */
  classTeacherStreaks(tenantId: string, userId: string): Promise<ClassTeacherStreaksDto> {
    return this.cache.getOrLoad(
      tenantId,
      DashboardWidgetKey.CLASS_TEACHER_STREAKS,
      `user:${userId}`,
      async () => {
        const homerooms = await this.teacherScope.homeroomSections({ userId, tenantId });
        // ponytail: one homeroom section only (the card names one class); a teacher with two
        // homeroom sections sees the CLASS_TEACHER one. Add a section picker when a school asks.
        const home =
          homerooms.find((h) => h.assignment_type === TeacherAssignmentType.CLASS_TEACHER) ??
          homerooms[0];
        if (!home) return { section: null, as_of_date: null, total: 0, items: [] };
        const { items, as_of_date } = await this.summaryService.getSectionStreaks({
          tenantId,
          sectionId: home.section_id,
        });
        const absent = items.filter((i) => i.status === AttendanceStatus.ABSENT);
        return {
          section: {
            section_id: home.section_id,
            class_name: home.class_name,
            section_name: home.section_name,
          },
          as_of_date,
          total: absent.length,
          items: absent.slice(0, 10).map(({ status: _status, ...rest }) => rest),
        };
      },
    );
  }

  private async load(
    tenantId: string,
    role: string,
    userId: string,
  ): Promise<AttendanceTodayWidgetDto> {
    const policy = resolveAttendancePolicy(await this.schoolsService.getResolvedSettings(tenantId));
    const date = await this.schoolsService.todayFor(tenantId);
    const rows = await this.attendanceService.listMySections({ role, userId, tenantId, date });

    const counts = { present: 0, late: 0, absent: 0, leave: 0, unmarked: 0 };
    const pending_sections: AttendanceTodayWidgetDto['pending_sections'] = [];
    for (const row of rows) {
      if (row.today) {
        counts.present += row.today.present;
        counts.late += row.today.late;
        counts.absent += row.today.absent;
        counts.leave += row.today.leave;
        counts.unmarked += row.today.unmarked;
      }
      if (row.is_working_day && row.today?.state !== AttendanceSessionState.FINALIZED) {
        pending_sections.push({
          section_id: row.section_id,
          class_name: row.class_name,
          section_name: row.section_name,
        });
      }
    }
    const percentage = percentageOf(counts, policy);

    // Yesterday's 30 points come from the nightly cache; drop the oldest, append today's live one.
    const past = await this.pastSeries(tenantId, addDays(date, -1));
    const series = [...past.slice(1), { date, percentage }];
    const weekAgo = addDays(date, -7);

    return {
      date,
      is_working_day: rows.some((r) => r.is_working_day),
      percentage,
      counts,
      sections_total: rows.length,
      pending_sections,
      week_ago_percentage: series.find((p) => p.date === weekAgo)?.percentage ?? null,
      series,
    };
  }

  /** Read the nightly value; on a miss (or Redis error) compute once and store. */
  async pastSeries(tenantId: string, to: string): Promise<AttendanceSeriesPointDto[]> {
    const key = this.seriesKey(tenantId, to);
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as AttendanceSeriesPointDto[];
    } catch (error) {
      this.logger.error(`Attendance series read failed for ${key}: ${String(error)}`);
    }
    return this.storeSeries(tenantId, to);
  }

  /** Compute and cache the 30 points ending `to` (also the nightly job's entry point). */
  async storeSeries(tenantId: string, to: string): Promise<AttendanceSeriesPointDto[]> {
    const series = await this.computeSeries(tenantId, to);
    const key = this.seriesKey(tenantId, to);
    try {
      await this.redis.set(key, JSON.stringify(series), 'EX', ATTENDANCE_SERIES_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Attendance series write failed for ${key}: ${String(error)}`);
    }
    return series;
  }

  /** One grouped query over whole-day registers; days with no records are `null`. */
  async computeSeries(tenantId: string, to: string): Promise<AttendanceSeriesPointDto[]> {
    const from = addDays(to, -(ATTENDANCE_SERIES_DAYS - 1));
    const policy = resolveAttendancePolicy(await this.schoolsService.getResolvedSettings(tenantId));
    const rows = await this.dayRecords(tenantId)
      .select('r.date::text', 'date')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('r.date BETWEEN :from AND :to', { from, to })
      .groupBy('r.date')
      .addGroupBy('r.status')
      .getRawMany<{ date: string; status: string; count: string }>();

    const byDate = new Map<string, Tally>();
    for (const row of rows) {
      const c = byDate.get(row.date) ?? { present: 0, late: 0, absent: 0, leave: 0 };
      const status = row.status.toLowerCase() as keyof Tally;
      if (status in c) c[status] += Number(row.count);
      byDate.set(row.date, c);
    }
    return Array.from({ length: ATTENDANCE_SERIES_DAYS }, (_, i) => {
      const date = addDays(from, i);
      const c = byDate.get(date);
      return { date, percentage: c ? percentageOf(c, policy) : null };
    });
  }

  /**
   * The one FROM / JOIN / WHERE behind every attendance percentage on a dashboard:
   * whole-day registers that are FINALIZED (a draft is not a result), for students on the
   * roll that day (same rule as `sectionRosterStudentIds({ onRollOn })`: ACTIVE, or the
   * last leaving event is after the record's date). `yearId` limits it to that academic
   * year's sections, so last year's registers never leak into this year's numbers.
   */
  private dayRecords(tenantId: string, yearId?: string) {
    // Same year restriction as the outer filter, pushed into the roll so it is not built for every
    // section of every past year. A fixed fragment: the year is bound as :yearId.
    const rollYearFilter = yearId
      ? ' AND e.section_id IN (SELECT cs.id FROM class_sections cs JOIN classes c ON c.id = cs.class_id WHERE c.academic_year_id = :yearId)'
      : '';
    const qb = this.recordRepo
      .createQueryBuilder('r')
      .innerJoin('attendance_sessions', 's', 's.id = r.session_id AND s.tenant_id = r.tenant_id')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('s.period_no IS NULL')
      .andWhere('s.state = :finalized', { finalized: AttendanceSessionState.FINALIZED })
      // On-roll rule, evaluated ONCE per (student, section) instead of once per register row:
      // a student can hold several enrollments in one section (past years), and the old
      // correlated EXISTS re-ran the leaving-event lookup for every one of them per record.
      // "Some enrollment is ACTIVE, or the latest leaving event of some enrollment is after
      // the date" == bool_or(active) OR max(left_on) > date, so the result is identical.
      .innerJoin(
        `(SELECT e.student_id, e.section_id,
                 bool_or(e.enrollment_status = :onRollActive) AS active,
                 MAX((SELECT MAX(le.occurred_on) FROM student_lifecycle_events le
                      WHERE le.tenant_id = e.tenant_id AND le.student_id = e.student_id
                        AND le.enrollment_id = e.id AND le.event_type <> :onRollReadmitted)) AS left_on
            FROM enrollments e
            JOIN students st ON st.id = e.student_id AND st.tenant_id = e.tenant_id AND st.deleted_at IS NULL
           WHERE e.tenant_id = :tenantId${rollYearFilter}
           GROUP BY e.student_id, e.section_id)`,
        'roll',
        'roll.student_id = r.student_id AND roll.section_id = s.section_id AND (roll.active OR roll.left_on > r.date)',
        {
          onRollActive: EnrollmentStatus.ACTIVE,
          onRollReadmitted: StudentLifecycleEventType.READMITTED,
          yearId,
        },
      );
    if (yearId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.id = s.section_id AND c.academic_year_id = :yearId)`,
        { yearId },
      );
    }
    return qb;
  }

  private async currentYear(tenantId: string) {
    const [year] = await this.recordRepo.manager.query<{ id: string; start: string }[]>(
      `SELECT id, start_date::text AS start FROM academic_years
         WHERE tenant_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );
    return year;
  }

  committeeDailyKey(tenantId: string, yearId: string, to: string): string {
    return `tenant:${tenantId}:dash:${DashboardWidgetKey.COMMITTEE_ATTENDANCE}:daily:${yearId}:${to}`;
  }

  /** One grouped query: the finalized whole-day tally of every date in [from, to] of that year. */
  private async dailyTallies(
    tenantId: string,
    yearId: string,
    from: string,
    to: string,
  ): Promise<DayTally[]> {
    const rows = await this.dayRecords(tenantId, yearId)
      .select('r.date::text', 'date')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('r.date BETWEEN :from AND :to', { from, to })
      .groupBy('r.date')
      .addGroupBy('r.status')
      .getRawMany<{ date: string; status: string; count: string }>();
    const byDate = new Map<string, DayTally>();
    for (const row of rows) {
      const c = byDate.get(row.date) ?? {
        date: row.date,
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
      };
      const status = row.status.toLowerCase();
      if (status === 'present' || status === 'late' || status === 'absent' || status === 'leave') {
        c[status] += Number(row.count);
      }
      byDate.set(row.date, c);
    }
    return [...byDate.values()];
  }

  /**
   * Per-day tallies from the year's start to `to` (today-8, see COMMITTEE_LIVE_DAYS). The
   * nightly job writes this; on a miss (or Redis error) compute once and store. The committee
   * card folds it by month, so a request queries only the last week live instead of
   * scanning the whole year's register rows.
   */
  async committeeDaily(
    tenantId: string,
    year: { id: string; start: string },
    to: string,
  ): Promise<DayTally[]> {
    const key = this.committeeDailyKey(tenantId, year.id, to);
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as DayTally[];
    } catch (error) {
      this.logger.error(`Committee attendance read failed for ${key}: ${String(error)}`);
    }
    const daily =
      year.start <= to ? await this.dailyTallies(tenantId, year.id, year.start, to) : [];
    try {
      await this.redis.set(key, JSON.stringify(daily), 'EX', ATTENDANCE_SERIES_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Committee attendance write failed for ${key}: ${String(error)}`);
    }
    return daily;
  }

  /** Nightly entry point: rebuild the current year's daily tallies ending `to` (today-8). */
  async storeCommitteeDaily(tenantId: string, to: string): Promise<void> {
    const year = await this.currentYear(tenantId);
    if (!year) return;
    await this.redis.del(this.committeeDailyKey(tenantId, year.id, to));
    await this.committeeDaily(tenantId, year, to);
  }

  /**
   * Committee card: school-wide attendance % for each month of the current academic year,
   * up to this month. Days older than a week come from the nightly per-day cache; the last
   * 7 days and today are one live query (a mark made now still shows within the 60 s widget
   * cache); both fold with the same percentage function.
   */
  getCommitteeMonthly(tenantId: string): Promise<CommitteeAttendanceDto> {
    return this.cache.getOrLoad(
      tenantId,
      DashboardWidgetKey.COMMITTEE_ATTENDANCE,
      'school',
      async () => {
        const settings = await this.schoolsService.getResolvedSettings(tenantId);
        const policy = resolveAttendancePolicy(settings);
        const target = settings.dashboard?.committeeAttendanceTargetPct ?? 90;
        const today = localToday(settings.region?.timezone ?? DEFAULT_REGION_SETTINGS.timezone);
        const year = await this.currentYear(tenantId);
        if (!year) {
          return {
            months: [],
            current_month_percentage: null,
            year_percentage: null,
            target_percentage: target,
          };
        }
        // Cached up to today-8; the last 7 days + today are live, so a register finalised or
        // corrected within a week shows within the 60 s widget cache. Older days lag until
        // the next nightly run.
        const past = await this.committeeDaily(
          tenantId,
          year,
          addDays(today, -COMMITTEE_LIVE_DAYS - 1),
        );
        const liveFrom = addDays(today, -COMMITTEE_LIVE_DAYS);
        const live =
          year.start <= today
            ? await this.dailyTallies(
                tenantId,
                year.id,
                year.start > liveFrom ? year.start : liveFrom,
                today,
              )
            : [];

        const byMonth = new Map<string, Tally>();
        const whole: Tally = { present: 0, late: 0, absent: 0, leave: 0 };
        for (const day of [...past, ...live]) {
          const month = day.date.slice(0, 7);
          const c = byMonth.get(month) ?? { present: 0, late: 0, absent: 0, leave: 0 };
          for (const k of ['present', 'late', 'absent', 'leave'] as const) {
            c[k] += day[k];
            whole[k] += day[k];
          }
          byMonth.set(month, c);
        }
        const months: CommitteeAttendanceMonthDto[] = [];
        for (let m = year.start.slice(0, 7); m <= today.slice(0, 7); m = nextMonth(m)) {
          const c = byMonth.get(m);
          months.push({ month: m, percentage: c ? percentageOf(c, policy) : null });
        }
        return {
          months,
          current_month_percentage: months[months.length - 1]?.percentage ?? null,
          year_percentage: percentageOf(whole, policy),
          target_percentage: target,
        };
      },
    );
  }
}

/** Days before today the committee card recomputes live (cache covers everything older). */
export const COMMITTEE_LIVE_DAYS = 7;

function nextMonth(m: string): string {
  const d = new Date(`${m}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}
