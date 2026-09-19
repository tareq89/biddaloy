import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { Subject } from './entities/subject.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { AcademicYearService } from './academic-year.service';
import { AcademicYearController } from './academic-year.controller';
import { SubjectService } from './subjects.service';
import { SubjectController, ClassSubjectController } from './subjects.controller';
import { SchoolsModule } from '../schools/schools.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  // Class/Enrollment/FeeStructure are registered entity-only (no
  // StudentsModule/FeesModule import) so AcademicYearService can count
  // against them for `getStats` without a cross-module DI cycle.
  // The holiday/calendar entity+service+controller moved to `CalendarModule`
  // in [17.1.2] as `CalendarEvent`/`SchoolCalendarService` — this module no
  // longer owns any of that.
  imports: [
    TypeOrmModule.forFeature([
      AcademicYear,
      Class,
      Subject,
      ClassSubject,
      Enrollment,
      FeeStructure,
    ]),
    SchoolsModule,
    AuditModule,
  ],
  providers: [AcademicYearService, SubjectService],
  controllers: [AcademicYearController, SubjectController, ClassSubjectController],
  // SubjectService is exported for [9.3]'s teacher-scoping query.
  exports: [AcademicYearService, SubjectService],
})
export class AcademicYearModule {}
