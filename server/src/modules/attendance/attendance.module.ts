import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { AttendanceDeviceEvent } from './entities/attendance-device-event.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { AcademicYearModule } from '../academics/academic-year.module';
import { StudentModule } from '../students/students.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceAccessService } from './attendance-access.service';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceSummaryController } from './attendance-summary.controller';

/**
 * [9.2] was entity-only. [9.3] fills `providers`/`controllers` in. [9.4]
 * adds `AttendanceSummaryService`/`AttendanceSummaryController` and imports
 * `AcademicYearModule` for `SchoolCalendarService` (working-day math) and
 * `StudentModule` for `FamilyAccessService` (PARENT/STUDENT scoping on the
 * summary routes).
 *
 * `Student`/`ClassSection`/`TeacherClassSection` are registered here
 * (rather than importing StudentModule for entities too) so this module's
 * services can query against them without a cross-module DI cycle, same
 * reasoning as `classes.module.ts`'s own comment. `SchoolHoliday` moved to
 * `AcademicYearModule` in [9.4] — this module no longer queries it
 * directly, going through `SchoolCalendarService` instead (see
 * `attendance.service.ts`'s old `isHoliday` docstring, now removed).
 *
 * `AttendanceService`/`AttendanceAccessService` are exported — [9.4], [9.5]
 * and [9.8] inject them directly rather than re-deriving the same
 * section-access join or register-assembly logic.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AttendanceSession,
      AttendanceRecord,
      AttendanceDevice,
      AttendanceDeviceEvent,
      Student,
      ClassSection,
      TeacherClassSection,
    ]),
    AuditModule,
    SchoolsModule,
    AcademicYearModule,
    StudentModule,
  ],
  providers: [AttendanceService, AttendanceAccessService, AttendanceSummaryService],
  controllers: [AttendanceController, AttendanceSummaryController],
  exports: [TypeOrmModule, AttendanceService, AttendanceAccessService, AttendanceSummaryService],
})
export class AttendanceModule {}
