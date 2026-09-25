import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';

/**
 * [27.1] Schema-only module — registers the three admission entities with
 * TypeORM. Controllers/services land in later 27.x tickets.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AdmissionIntake, AdmissionApplicant, AdmissionEvaluation])],
  controllers: [],
  providers: [],
})
export class AdmissionModule {}
