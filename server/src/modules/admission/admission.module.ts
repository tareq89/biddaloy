import { Module, forwardRef } from '@nestjs/common';
import { WebsiteModule } from '../website/website.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { IntakeService } from './intake.service';
import { AdmissionStageService } from './admission-stage.service';
import { AdmissionFormSchemaService } from './admission-form-schema.service';
import { AdmissionStage } from './entities/admission-stage.entity';
import { IntakeController } from './intake.controller';
import { ApplicantReviewService } from './applicant-review.service';
import { ApplicantReviewController } from './applicant-review.controller';
import { StudentModule } from '../students/students.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { PublicAdmissionController } from './public-admission.controller';
import { AdmissionApplicantService } from './admission-applicant.service';
import { AdmissionNotificationService } from './admission-notification.service';
import { TurnstileService } from '../registration/turnstile.service';
import { SchoolsModule } from '../schools/schools.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { StudentLifecycleEvent } from '../students/entities/student-lifecycle-event.entity';
import { AdmissionReportsService } from './admission-reports.service';
import { AdmissionReportsController } from './admission-reports.controller';
import { AdmissionDashboardService } from './admission-dashboard.service';
import { AdmissionDashboardController } from './admission-dashboard.controller';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AdmissionFeeService } from './admission-fee.service';
import { AdmissionFeeController } from './admission-fee.controller';
import { AdmissionRollService } from './admission-roll.service';
import { AdmissionRollController } from './admission-roll.controller';
import { AdmissionStageResultService } from './admission-stage-result.service';
import { AdmissionStageResultController } from './admission-stage-result.controller';
import { AdmissionLotteryService } from './admission-lottery.service';
import { AdmissionLotteryController } from './admission-lottery.controller';
import { AdmissionListService } from './admission-list.service';
import { AdmissionListAutoJob, ADMISSION_LIST_AUTO_QUEUE } from './admission-list-auto.job';
import { AdmissionListController } from './admission-list.controller';
import { AdmissionPublicationService } from './admission-publication.service';
import { AdmissionPublicationController } from './admission-publication.controller';
import { AdmissionApplicantStaffController } from './admission-applicant-staff.controller';
import { AdmissionStageResult } from './entities/admission-stage-result.entity';
import { AdmissionList as AdmissionListEntity } from './entities/admission-list.entity';
import { AdmissionListMember } from './entities/admission-list-member.entity';
import { AdmissionFeeProof } from './entities/admission-fee-proof.entity';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';

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
    TypeOrmModule.forFeature([
      AdmissionIntake,
      AdmissionStage,
      AdmissionStageResult,
      AdmissionListEntity,
      AdmissionListMember,
      AdmissionFeeProof,
      AdmissionApplicant,
      AdmissionEvaluation,
      CommunicationLog,
      StudentLifecycleEvent,
    ]),
    BullModule.registerQueue({ name: ADMISSION_LIST_AUTO_QUEUE }),
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
    StudentModule,
    CreditsModule,
    SchoolsModule,
    StorageModule,
    AuditModule,
    DashboardModule,
    forwardRef(() => WebsiteModule),
  ],
  controllers: [
    IntakeController,
    ApplicantReviewController,
    PublicAdmissionController,
    AdmissionReportsController,
    AdmissionDashboardController,
    AdmissionApplicantStaffController,
    AdmissionFeeController,
    AdmissionRollController,
    AdmissionStageResultController,
    AdmissionLotteryController,
    AdmissionListController,
    AdmissionPublicationController,
  ],
  providers: [
    AdmissionDashboardService,
    IntakeService,
    AdmissionStageService,
    AdmissionFormSchemaService,
    ApplicantReviewService,
    AdmissionApplicantService,
    AdmissionNotificationService,
    AdmissionReportsService,
    TurnstileService,
    AdmissionFeeService,
    AdmissionRollService,
    AdmissionStageResultService,
    AdmissionLotteryService,
    AdmissionListService,
    AdmissionListAutoJob,
    AdmissionPublicationService,
  ],
  exports: [
    AdmissionApplicantService,
    AdmissionFormSchemaService,
    AdmissionFeeService,
    AdmissionRollService,
    AdmissionStageResultService,
    AdmissionLotteryService,
    AdmissionListService,
    AdmissionPublicationService,
  ],
})
export class AdmissionModule {}
