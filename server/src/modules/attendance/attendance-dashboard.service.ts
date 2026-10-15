import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AttendanceSessionState, DashboardWidgetKey } from '@biddaloy/shared';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceService } from './attendance.service';
import { computeAttendancePercentage } from './attendance-summary.service';
import { resolveAttendancePolicy } from './attendance-policy.util';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { SchoolsService } from '../schools/schools.service';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import type {
  AttendanceSeriesPointDto,
  AttendanceTodayWidgetDto,
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
    const rows = await this.recordRepo
      .createQueryBuilder('r')
      .innerJoin('attendance_sessions', 's', 's.id = r.session_id AND s.tenant_id = r.tenant_id')
      .select('r.date::text', 'date')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('s.period_no IS NULL')
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
}
