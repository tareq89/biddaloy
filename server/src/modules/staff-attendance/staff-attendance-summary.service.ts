import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttendanceStatus, Permission, roleHasPermission } from '@biddaloy/shared';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { SchoolsService } from '../schools/schools.service';
import { StaffProfilesService } from '../staff-profiles/staff-profiles.service';
import { resolveAttendancePolicy } from '../attendance/attendance-policy.util';
import { computeAttendancePercentage } from '../attendance/attendance-summary.service';
import { StaffAttendanceSummaryDto } from './dto/staff-attendance.dto';

/**
 * Read side of staff attendance — one staff member's counts and derived
 * percentage over a date range. Reuses
 * `attendance-summary.service.ts`'s `computeAttendancePercentage`, the
 * single source of truth for the percentage formula, so this can never
 * disagree with the student-attendance surface about what a percentage
 * means (D3, [36.2.2] plan).
 */
@Injectable()
export class StaffAttendanceSummaryService {
  constructor(
    @InjectRepository(StaffAttendanceRecord)
    private readonly recordRepo: Repository<StaffAttendanceRecord>,
    private readonly schoolCalendarService: SchoolCalendarService,
    private readonly schoolsService: SchoolsService,
    private readonly staffProfilesService: StaffProfilesService,
  ) {}

  async getSummary(params: {
    tenantId: string;
    staffProfileId: string;
    from: string;
    to: string;
    role: string;
    userId: string;
  }): Promise<StaffAttendanceSummaryDto> {
    const { tenantId, staffProfileId, from, to, role, userId } = params;

    // Same self-or-admin scoping `StaffAttendanceService.markDay` enforces
    // for writes — `STAFF_ATTENDANCE_READ` is held by every tenant role
    // for their own record, ADMIN/EXECUTIVE additionally for all staff.
    if (!roleHasPermission(role, Permission.LEAVE_APPROVE)) {
      const ownStaffProfileId = await this.staffProfilesService.findIdByUserId(userId);
      if (staffProfileId !== ownStaffProfileId) {
        throw new ForbiddenException({
          message: 'You may only read your own attendance summary',
          details: { code: 'STAFF_ATTENDANCE_NOT_OWN_PROFILE' },
        });
      }
    }

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    const workingDays = await this.schoolCalendarService.getWorkingDays({ tenantId, from, to });

    const counts = { present_days: 0, late_days: 0, absent_days: 0, leave_days: 0 };
    let markedDays = 0;

    if (workingDays.dates.length > 0) {
      const rows: Array<{ status: AttendanceStatus; count: string }> = await this.recordRepo
        .createQueryBuilder('r')
        .innerJoin('r.session', 's')
        .select('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.staff_profile_id = :staffProfileId', { staffProfileId })
        .andWhere('s.date = ANY(:workingDates)', { workingDates: workingDays.dates })
        .groupBy('r.status')
        .getRawMany();

      for (const row of rows) {
        const count = Number(row.count);
        markedDays += count;
        switch (row.status) {
          case AttendanceStatus.PRESENT:
            counts.present_days = count;
            break;
          case AttendanceStatus.LATE:
            counts.late_days = count;
            break;
          case AttendanceStatus.ABSENT:
            counts.absent_days = count;
            break;
          case AttendanceStatus.LEAVE:
            counts.leave_days = count;
            break;
        }
      }
    }

    const attendance_percentage = computeAttendancePercentage(
      { ...counts, working_days: workingDays.count, marked_days: markedDays },
      policy,
    );

    return {
      working_days: workingDays.count,
      present_days: counts.present_days,
      late_days: counts.late_days,
      absent_days: counts.absent_days,
      leave_days: counts.leave_days,
      attendance_percentage,
    };
  }
}
