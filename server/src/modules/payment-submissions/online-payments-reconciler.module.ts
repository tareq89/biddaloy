import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FeeModule } from '../fees/fees.module';
import { PaymentGatewaysModule } from '../payment-gateways/payment-gateways.module';
import { SchoolsModule } from '../schools/schools.module';
import {
  ONLINE_PAYMENTS_RECONCILE_QUEUE,
  OnlinePaymentsReconciler,
} from './online-payments.reconciler';

/** [3.6.02] Own module so the worker needs no edit to PaymentSubmissionsModule. */
@Module({
  imports: [
    BullModule.registerQueue({ name: ONLINE_PAYMENTS_RECONCILE_QUEUE }),
    PaymentGatewaysModule,
    SchoolsModule,
    FeeModule,
  ],
  providers: [OnlinePaymentsReconciler],
})
export class OnlinePaymentsReconcilerModule {}
