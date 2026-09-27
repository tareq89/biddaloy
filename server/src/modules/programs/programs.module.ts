import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Program } from './entities/program.entity';
import { ProgramMilestone } from './entities/program-milestone.entity';
import { ProgramEnrollment } from './entities/program-enrollment.entity';
import { MilestoneAchievement } from './entities/milestone-achievement.entity';
import { Student } from '../students/entities/student.entity';
import { AuditModule } from '../audit/audit.module';
import { StudentModule } from '../students/students.module';
import { ProgramsService } from './programs.service';
import { ProgramsController } from './programs.controller';
import { ProgramEnrollmentsService } from './program-enrollments.service';
import {
  MilestoneAchievementsController,
  ProgramEnrollmentsController,
  ProgramEnrollmentStatusController,
  StudentProgramsController,
} from './program-enrollments.controller';

/**
 * [34.1.3, 34.2.1] Program + milestone CRUD, archive/delete rules, plus
 * enrolment and achievement recording. Registers all four program entities
 * so both services can read/write `ProgramEnrollment`/`MilestoneAchievement`.
 * Imports `StudentModule` for `FamilyAccessService`, used by
 * `StudentProgramsController`'s portal-scoping (D24).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Program,
      ProgramMilestone,
      ProgramEnrollment,
      MilestoneAchievement,
      Student,
    ]),
    AuditModule,
    StudentModule,
  ],
  providers: [ProgramsService, ProgramEnrollmentsService],
  controllers: [
    ProgramsController,
    ProgramEnrollmentsController,
    ProgramEnrollmentStatusController,
    MilestoneAchievementsController,
    StudentProgramsController,
  ],
  exports: [ProgramsService, ProgramEnrollmentsService],
})
export class ProgramsModule {}
