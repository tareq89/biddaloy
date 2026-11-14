import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentSubmission } from './entities/payment-submission.entity';
import { PaymentSubmissionBill } from './entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from './entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from './entities/payment-submission-event.entity';

const ENTITIES = [
  PaymentSubmission,
  PaymentSubmissionBill,
  PaymentSubmissionFile,
  PaymentSubmissionEvent,
];

/** [3.x] Entities only; services and routes arrive with #3965/#3966. */
@Module({ imports: [TypeOrmModule.forFeature(ENTITIES)], exports: [TypeOrmModule] })
export class PaymentSubmissionsModule {}
