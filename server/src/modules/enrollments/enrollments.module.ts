import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditModule } from '../audit/audit.module';
import { EnrollmentService } from './enrollments.service';
import { EnrollmentController } from './enrollments.controller';
import { EnrollmentsDashboardController } from './enrollments-dashboard.controller';
import { EnrollmentsDashboardService } from './enrollments-dashboard.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Enrollment, Student, Class, ClassSection, AcademicYear]),
    AuditModule,
    DashboardModule,
  ],
  providers: [EnrollmentService, EnrollmentsDashboardService],
  controllers: [EnrollmentController, EnrollmentsDashboardController],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}
