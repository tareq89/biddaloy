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
    return `tenant:${tenantId}:dash:v1:${DashboardWidgetKey.ATTENDANCE_TODAY}:series:${to}`;
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
    const qb = this.recordRepo
      .createQueryBuilder('r')
      .innerJoin('attendance_sessions', 's', 's.id = r.session_id AND s.tenant_id = r.tenant_id')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('s.period_no IS NULL')
      .andWhere('s.state = :finalized', { finalized: AttendanceSessionState.FINALIZED })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM enrollments e
          JOIN students st ON st.id = e.student_id AND st.tenant_id = e.tenant_id AND st.deleted_at IS NULL
          WHERE e.tenant_id = r.tenant_id AND e.student_id = r.student_id AND e.section_id = s.section_id
            AND (e.enrollment_status = :onRollActive OR (
              SELECT MAX(le.occurred_on) FROM student_lifecycle_events le
              WHERE le.tenant_id = e.tenant_id AND le.student_id = e.student_id
                AND le.enrollment_id = e.id AND le.event_type <> :onRollReadmitted
            ) > r.date))`,
        {
          onRollActive: EnrollmentStatus.ACTIVE,
          onRollReadmitted: StudentLifecycleEventType.READMITTED,
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

  /**
   * Committee card: school-wide attendance % for each month of the current academic year,
   * up to this month. ONE grouped query, folded per month with the same percentage function.
   * ponytail: if the wave-6 load run shows p95 >= 300 ms, move finished months into the
   * nightly attendance-series.scheduler and keep only the current month live.
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
        const [year] = await this.recordRepo.manager.query<{ id: string; start: string }[]>(
          `SELECT id, start_date::text AS start FROM academic_years
         WHERE tenant_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
          [tenantId],
        );
        if (!year) {
          return {
            months: [],
            current_month_percentage: null,
            year_percentage: null,
            target_percentage: target,
          };
        }
        const rows = await this.dayRecords(tenantId, year.id)
          .select("to_char(r.date, 'YYYY-MM')", 'month')
          .addSelect('r.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .andWhere('r.date BETWEEN :from AND :to', { from: year.start, to: today })
          .groupBy("to_char(r.date, 'YYYY-MM')")
          .addGroupBy('r.status')
          .getRawMany<{ month: string; status: string; count: string }>();

        const byMonth = new Map<string, Tally>();
        const whole: Tally = { present: 0, late: 0, absent: 0, leave: 0 };
        for (const row of rows) {
          const c = byMonth.get(row.month) ?? { present: 0, late: 0, absent: 0, leave: 0 };
          const status = row.status.toLowerCase() as keyof Tally;
          if (status in c) {
            c[status] += Number(row.count);
            whole[status] += Number(row.count);
          }
          byMonth.set(row.month, c);
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

function nextMonth(m: string): string {
  const d = new Date(`${m}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}
