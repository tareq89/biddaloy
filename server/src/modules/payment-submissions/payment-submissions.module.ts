import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { StorageModule } from '../storage/storage.module';
import { StudentModule } from '../students/students.module';
import { PaymentSubmission } from './entities/payment-submission.entity';
import { PaymentSubmissionBill } from './entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from './entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from './entities/payment-submission-event.entity';
import { ProofSubmissionsController } from './proof-submissions.controller';
import { ProofSubmissionsService } from './proof-submissions.service';

const ENTITIES = [
  PaymentSubmission,
  PaymentSubmissionBill,
  PaymentSubmissionFile,
  PaymentSubmissionEvent,
];

/** [3.x] Entities plus the guardian proof routes (#3965). Staff review arrives with #3966. */
@Module({
  imports: [
    TypeOrmModule.forFeature(ENTITIES),
    AuditModule,
    SchoolsModule,
    StorageModule,
    StudentModule,
  ],
  controllers: [ProofSubmissionsController],
  providers: [ProofSubmissionsService],
  exports: [TypeOrmModule, ProofSubmissionsService],
})
export class PaymentSubmissionsModule {}
