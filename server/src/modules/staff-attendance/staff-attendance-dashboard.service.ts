import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AttendanceStatus, DashboardWidgetKey, LeaveStatus } from '@biddaloy/shared';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { SchoolsService } from '../schools/schools.service';
import type { StaffOnLeaveDto, StaffTodayWidgetDto } from './dto/staff-attendance-dashboard.dto';

/** Active staff = a staff profile whose user is not deleted and ACTIVE (the staff grid's list). */
const ACTIVE_STAFF_JOIN = `JOIN users u ON u.id = sp.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'`;

/** "Teachers and staff" dashboard widget: today's staff marks plus who is on approved leave. */
@Injectable()
export class StaffAttendanceDashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly cache: DashboardCacheService,
  ) {}

  getToday(tenantId: string): Promise<StaffTodayWidgetDto> {
    return this.cache.getOrLoad(tenantId, DashboardWidgetKey.STAFF_TODAY, 'school', () =>
      this.load(tenantId),
    );
  }

  private async load(tenantId: string): Promise<StaffTodayWidgetDto> {
    const date = await this.schoolsService.todayFor(tenantId);

    const [{ total }] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*) AS total FROM staff_profiles sp ${ACTIVE_STAFF_JOIN} WHERE sp.tenant_id = $1`,
      [tenantId],
    );

    const marks = await this.dataSource.query<
      Array<{ status: AttendanceStatus; staff_id: string }>
    >(
      `SELECT r.status, r.staff_profile_id AS staff_id
         FROM staff_attendance_records r
         JOIN staff_attendance_sessions s ON s.id = r.session_id
         JOIN staff_profiles sp ON sp.id = r.staff_profile_id
         ${ACTIVE_STAFF_JOIN}
        WHERE r.tenant_id = $1 AND s.date = $2`,
      [tenantId, date],
    );

    const on_leave = (
      await this.dataSource.query<
        Array<{ staff_profile_id: string; full_name: string; leave_type: string; end_date: string }>
      >(
        `SELECT l.staff_profile_id, u.full_name, l.leave_type, l.end_date::text AS end_date
           FROM leave_records l
           JOIN staff_profiles sp ON sp.id = l.staff_profile_id
           ${ACTIVE_STAFF_JOIN}
          WHERE l.tenant_id = $1 AND l.status = $2 AND l.start_date <= $3 AND l.end_date >= $3
          ORDER BY u.full_name, l.staff_profile_id`,
        [tenantId, LeaveStatus.APPROVED, date],
      )
    ).map((r) => r as unknown as StaffOnLeaveDto);

    const onLeaveIds = new Set(on_leave.map((l) => l.staff_profile_id));
    const count = (s: AttendanceStatus) => marks.filter((m) => m.status === s).length;

    return {
      date,
      staff_total: Number(total),
      present: count(AttendanceStatus.PRESENT),
      late: count(AttendanceStatus.LATE),
      absent: count(AttendanceStatus.ABSENT),
      leave: on_leave.length,
      unmarked: Number(total) - marks.length,
      absent_without_leave: marks.filter(
        (m) => m.status === AttendanceStatus.ABSENT && !onLeaveIds.has(m.staff_id),
      ).length,
      on_leave,
    };
  }
}
