import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAttendanceSession } from './entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { CalendarModule } from '../calendar/calendar.module';
import { StaffProfilesModule } from '../staff-profiles/staff-profiles.module';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceSummaryService } from './staff-attendance-summary.service';
import { StaffAttendanceController } from './staff-attendance.controller';
import { DashboardModule } from '../dashboard/dashboard.module';
import { StaffAttendanceDashboardService } from './staff-attendance-dashboard.service';
import { StaffAttendanceDashboardController } from './staff-attendance-dashboard.controller';

/** [36.2.2] Staff attendance module — mark/correct a day, per-staff
 * summary. See `attendance.module.ts` for the pattern this mirrors. */
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffAttendanceSession, StaffAttendanceRecord, StaffProfile]),
    AuditModule,
    SchoolsModule,
    CalendarModule,
    StaffProfilesModule,
    DashboardModule,
  ],
  providers: [
    StaffAttendanceService,
    StaffAttendanceSummaryService,
    StaffAttendanceDashboardService,
  ],
  controllers: [StaffAttendanceController, StaffAttendanceDashboardController],
  exports: [
    TypeOrmModule,
    StaffAttendanceService,
    StaffAttendanceSummaryService,
    StaffAttendanceDashboardService,
  ],
})
export class StaffAttendanceModule {}
