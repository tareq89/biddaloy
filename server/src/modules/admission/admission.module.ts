import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { IntakeService } from './intake.service';
import { IntakeController } from './intake.controller';

/**
 * [27.1] Registers the three admission entities with TypeORM.
 * [27.3] Adds staff intake CRUD (`IntakeController`/`IntakeService`).
 * Applicant/evaluation controllers land in later 27.x tickets.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AdmissionIntake, AdmissionApplicant, AdmissionEvaluation])],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class AdmissionModule {}
