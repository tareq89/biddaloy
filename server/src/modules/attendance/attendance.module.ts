import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { AttendanceDeviceEvent } from './entities/attendance-device-event.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { SchoolHoliday } from '../academics/entities/school-holiday.entity';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceAccessService } from './attendance-access.service';

/**
 * [9.2] was entity-only. [9.3] fills `providers`/`controllers` in.
 * `Student`/`ClassSection`/`TeacherClassSection`/`SchoolHoliday` are
 * registered here (rather than importing StudentModule/AcademicsModule) so
 * this module's services can query against them without a cross-module DI
 * cycle, same reasoning as `classes.module.ts`'s own comment.
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
      SchoolHoliday,
    ]),
    AuditModule,
    SchoolsModule,
  ],
  providers: [AttendanceService, AttendanceAccessService],
  controllers: [AttendanceController],
  exports: [TypeOrmModule, AttendanceService, AttendanceAccessService],
})
export class AttendanceModule {}
