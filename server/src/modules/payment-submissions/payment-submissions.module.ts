import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FeeModule } from '../fees/fees.module';
import { SchoolsModule } from '../schools/schools.module';
import { StorageModule } from '../storage/storage.module';
import { StudentModule } from '../students/students.module';
import { PaymentSubmission } from './entities/payment-submission.entity';
import { PaymentSubmissionBill } from './entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from './entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from './entities/payment-submission-event.entity';
import { PaymentReversalListener } from './payment-reversal.listener';
import { ProofReviewController } from './proof-review.controller';
import { ProofReviewService } from './proof-review.service';
import { ProofSubmissionsController } from './proof-submissions.controller';
import { ProofSubmissionsService } from './proof-submissions.service';

const ENTITIES = [
  PaymentSubmission,
  PaymentSubmissionBill,
  PaymentSubmissionFile,
  PaymentSubmissionEvent,
];

/** [3.x] Entities, guardian proof routes (#3965), staff review and reversal wiring (#3970). */
@Module({
  imports: [
    TypeOrmModule.forFeature(ENTITIES),
    AuditModule,
    FeeModule,
    SchoolsModule,
    StorageModule,
    StudentModule,
  ],
  controllers: [ProofSubmissionsController, ProofReviewController],
  providers: [ProofSubmissionsService, ProofReviewService, PaymentReversalListener],
  exports: [TypeOrmModule, ProofSubmissionsService],
})
export class PaymentSubmissionsModule {}
