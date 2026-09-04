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

@Module({
  // Class/Enrollment/FeeStructure are registered entity-only (no
  // StudentsModule/FeesModule import) so AcademicYearService can count
  // against them for `getStats` without a cross-module DI cycle.
  imports: [
    TypeOrmModule.forFeature([
      AcademicYear,
      Class,
      Subject,
      ClassSubject,
      Enrollment,
      FeeStructure,
    ]),
  ],
  providers: [AcademicYearService, SubjectService],
  controllers: [AcademicYearController, SubjectController, ClassSubjectController],
  // SubjectService is exported for [9.3]'s teacher-scoping query, not
  // needed by anything in this ticket.
  exports: [AcademicYearService, SubjectService],
})
export class AcademicYearModule {}
