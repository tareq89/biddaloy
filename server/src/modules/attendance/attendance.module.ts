import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { AttendanceDeviceEvent } from './entities/attendance-device-event.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';

/**
 * Entity-only ticket ([9.2]) — no controllers or services yet. [9.3] fills
 * `providers`/`controllers` in; `Student`/`ClassSection`/`TeacherClassSection`
 * are registered here (rather than importing StudentModule/ClassModule) so
 * [9.3]'s marking service can query against them without a cross-module DI
 * cycle, same reasoning as `classes.module.ts`'s own comment.
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
  ],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class AttendanceModule {}
