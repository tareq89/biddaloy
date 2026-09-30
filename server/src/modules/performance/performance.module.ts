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
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcrModule } from '../acr/acr.module';
import { SurveysModule } from '../surveys/surveys.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { StaffPerformanceController } from './staff-performance.controller';
import { StaffPerformanceService } from './staff-performance.service';
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
      Teacher,
      TeacherClassSection,
      UserTenant,
    ]),
    ExamsModule,
    AttendanceModule,
    HomeworkModule,
    SchoolsModule,
    AcrModule,
    SurveysModule,
    IncidentsModule,
  ],
  controllers: [PerformanceController, StaffPerformanceController],
  providers: [PerformanceService, StaffPerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
