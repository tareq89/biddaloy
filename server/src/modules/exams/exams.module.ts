import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AuditModule } from '../audit/audit.module';
import { ExamsService } from './exams.service';
import { ExamsController } from './exams.controller';
import { ExamComponentsService } from './exam-components.service';
import { ExamComponentsController } from './exam-components.controller';
import { SubjectChoicesService } from '../students/subject-choices.service';
import { SubjectChoicesController } from '../students/subject-choices.controller';

/**
 * [19.2.1]/[19.3.1] Registers the seven exam/marks/results tables plus the
 * cross-module entities (`Student`, `ClassSection`, `ClassSubject`) the
 * 19.3.1 CRUD services need. `SubjectChoicesService`/`Controller` live
 * physically under `students/` (they read/write `StudentSubjectChoice`,
 * a student-owned row) but are wired here rather than in `StudentModule`,
 * since 19.3.1's "fourth subject" feature is exam/marks scoped work, not
 * a students-module change.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exam,
      ExamComponent,
      Mark,
      MarkGrid,
      Result,
      ResultSubject,
      StudentSubjectChoice,
      Student,
      ClassSection,
      ClassSubject,
      Class,
      AcademicYear,
      AcademicTerm,
      Subject,
    ]),
    AuditModule,
  ],
  controllers: [ExamsController, ExamComponentsController, SubjectChoicesController],
  providers: [ExamsService, ExamComponentsService, SubjectChoicesService],
  exports: [TypeOrmModule],
})
export class ExamsModule {}
