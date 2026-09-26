import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Program } from './entities/program.entity';
import { ProgramMilestone } from './entities/program-milestone.entity';
import { ProgramEnrollment } from './entities/program-enrollment.entity';
import { MilestoneAchievement } from './entities/milestone-achievement.entity';
import { AuditModule } from '../audit/audit.module';
import { ProgramsService } from './programs.service';
import { ProgramsController } from './programs.controller';

/**
 * [34.1.3] Program + milestone CRUD, archive, and delete rules. Registers
 * all four entities so `ProgramsService` can read `ProgramEnrollment`/
 * `MilestoneAchievement` counts for the D23 delete rules, even though
 * their own CRUD/recording endpoints come in 34.2.1.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Program, ProgramMilestone, ProgramEnrollment, MilestoneAchievement]),
    AuditModule,
  ],
  providers: [ProgramsService],
  controllers: [ProgramsController],
  exports: [ProgramsService],
})
export class ProgramsModule {}
