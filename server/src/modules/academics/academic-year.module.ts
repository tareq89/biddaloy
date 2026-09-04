import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { Subject } from './entities/subject.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { SchoolHoliday } from './entities/school-holiday.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { AcademicYearService } from './academic-year.service';
import { AcademicYearController } from './academic-year.controller';
import { SubjectService } from './subjects.service';
import { SubjectController, ClassSubjectController } from './subjects.controller';
import { SchoolCalendarService } from './school-calendar.service';
import { SchoolCalendarController } from './school-calendar.controller';
import { SchoolsModule } from '../schools/schools.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  // Class/Enrollment/FeeStructure are registered entity-only (no
  // StudentsModule/FeesModule import) so AcademicYearService can count
  // against them for `getStats` without a cross-module DI cycle.
  // SchoolHoliday now has its own controller/service — [9.4] owns its CRUD.
  // SchoolsModule is imported (not entity-only) because
  // SchoolCalendarService resolves each tenant's attendance policy via
  // `SchoolsService.getResolvedSettings` for its working-day math.
  imports: [
    TypeOrmModule.forFeature([
      AcademicYear,
      Class,
      Subject,
      ClassSubject,
      SchoolHoliday,
      Enrollment,
      FeeStructure,
    ]),
    SchoolsModule,
    AuditModule,
  ],
  providers: [AcademicYearService, SubjectService, SchoolCalendarService],
  controllers: [
    AcademicYearController,
    SubjectController,
    ClassSubjectController,
    SchoolCalendarController,
  ],
  // SubjectService is exported for [9.3]'s teacher-scoping query.
  // SchoolCalendarService is exported for [9.4]'s AttendanceModule (working-day
  // math for the summary service) and for AttendanceService's non-working-day
  // check on the write path.
  exports: [AcademicYearService, SubjectService, SchoolCalendarService],
})
export class AcademicYearModule {}
