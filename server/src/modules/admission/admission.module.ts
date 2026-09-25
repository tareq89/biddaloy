import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { PublicAdmissionController } from './public-admission.controller';
import { AdmissionApplicantService } from './admission-applicant.service';
import { SchoolsModule } from '../schools/schools.module';
import { StorageModule } from '../storage/storage.module';

/**
 * [27.1] registers the three admission entities with TypeORM.
 * [27.2] adds the unauthenticated public-submission surface
 * (`PublicAdmissionController`/`AdmissionApplicantService`). Later 27.x
 * tickets add the staff-facing review routes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AdmissionIntake, AdmissionApplicant, AdmissionEvaluation]),
    SchoolsModule,
    StorageModule,
  ],
  controllers: [PublicAdmissionController],
  providers: [AdmissionApplicantService],
})
export class AdmissionModule {}
