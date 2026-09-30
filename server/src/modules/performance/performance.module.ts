import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exam } from '../exams/entities/exam.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { StudentNote } from '../students/entities/student-note.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { ExamsModule } from '../exams/exams.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { HomeworkModule } from '../homework/homework.module';
import { SchoolsModule } from '../schools/schools.module';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

/**
 * [28.1.2] Shell registered once in AppModule (D25).
 * [28.3.5] Student + class performance; `exports` lets #1243 reuse the service.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exam,
      Student,
      Enrollment,
      Class,
      ClassSection,
      AcademicYear,
      AcademicTerm,
      StudentNote,
    ]),
    ExamsModule,
    AttendanceModule,
    HomeworkModule,
    SchoolsModule,
  ],
  controllers: [PerformanceController],
  providers: [PerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
