import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { IntakeService } from './intake.service';
import { IntakeController } from './intake.controller';
import { ApplicantReviewService } from './applicant-review.service';
import { ApplicantReviewController } from './applicant-review.controller';
import { StudentModule } from '../students/students.module';
import { PublicAdmissionController } from './public-admission.controller';
import { AdmissionApplicantService } from './admission-applicant.service';
import { AdmissionNotificationService } from './admission-notification.service';
import { SchoolsModule } from '../schools/schools.module';
import { StorageModule } from '../storage/storage.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';

/**
 * [27.1] Registers the three admission entities with TypeORM.
 * [27.2] Adds the unauthenticated public-submission surface
 * (`PublicAdmissionController`/`AdmissionApplicantService`).
 * [27.3] Adds staff intake CRUD (`IntakeController`/`IntakeService`).
 * [27.5] Adds applicant review/evaluate/admit/reject
 * (`ApplicantReviewController`/`ApplicantReviewService`), which reuses
 * `StudentModule`'s `StudentService`/`GuardianService` for the admit
 * conversion.
 * [27.7] Adds status-change notifications (`AdmissionNotificationService`) —
 * writes `CommunicationLog` rows and enqueues them on the same
 * `COMMUNICATIONS_QUEUE` BullMQ queue every other channel uses.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AdmissionIntake, AdmissionApplicant, AdmissionEvaluation, CommunicationLog]),
    BullModule.registerQueue({ name: COMMUNICATIONS_QUEUE }),
    StudentModule,
    SchoolsModule,
    StorageModule,
  ],
  controllers: [IntakeController, ApplicantReviewController, PublicAdmissionController],
  providers: [IntakeService, ApplicantReviewService, AdmissionApplicantService, AdmissionNotificationService],
})
export class AdmissionModule {}
