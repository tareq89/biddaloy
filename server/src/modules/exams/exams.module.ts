import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';

/**
 * [19.2.1] Entity-only for now — registers the seven exam/marks/results
 * tables this ticket's migration creates. Services, controllers and
 * cross-module imports (Student, ClassSection, GradingScale, …) are added
 * by the tickets that need them (19.3.1 onward), same shape as
 * `AttendanceModule`'s own [9.2] entity-only start.
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
    ]),
  ],
  exports: [TypeOrmModule],
})
export class ExamsModule {}
