import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
import { RecurringSchedule } from './entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from './entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from './entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { School } from '../schools/entities/school.entity';
import { AuditModule } from '../audit/audit.module';
import { StudentModule } from '../students/students.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SchoolsModule } from '../schools/schools.module';
import { FeeStructureService, PaymentService } from './fees.service';
import { PaymentsQueryService } from './payments-query.service';
import { FeeGenerationService, NoopDiscountResolver } from './fee-generation.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { FeeDuesService } from './fee-dues.service';
import { FeeGenerationsService } from './fee-generations.service';
import { FeeGenerationBatchService } from './fee-generation-batch.service';
import { RecurringSchedulesService } from './recurring-schedules.service';
import { FeeController } from './fees.controller';
import { FeeGenerationsController } from './fee-generations.controller';
import { RecurringSchedulesController } from './recurring-schedules.controller';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { CheckoutCartService } from './checkout-cart.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { PaymentReversalService } from './payment-reversal.service';
import { FeesDailyScheduler } from './fees-daily.scheduler';
import { FEES_DAILY_QUEUE } from './fees.constants';
import { DiscountRule } from './entities/discount-rule.entity';
import { DiscountRulesService } from './discount-rules.service';
import { DiscountRulesController } from './discount-rules.controller';
import { LateFeeService } from './late-fee.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeStructure,
      Payment,
      PaymentAllocation,
      StudentFee,
      FeeGeneration,
      RecurringSchedule,
      RecurringScheduleStructure,
      RecurringScheduleExclusion,
      StudentWallet,
      WalletTransaction,
      Student,
      Class,
      ClassSection,
      AcademicYear,
      Invoice,
      School,
      DiscountRule,
    ]),
    BullModule.registerQueue({ name: FEES_DAILY_QUEUE }),
    AuditModule,
    StudentModule,
    InvoicesModule,
    // [CI failure, PR #801] FeeModule -> SchoolsModule -> AccountAccessModule
    // -> CommunicationsModule -> FeeModule is a cycle — CommunicationsModule
    // already forwardRef()s its own edge to SchoolsModule for exactly this
    // triangle (see the comment on that import in
    // communications.module.ts). This edge was a plain import until
    // FeesDailyScheduler needed SchoolsService ([16.7.2]) — without
    // forwardRef here, SchoolsModule resolves to undefined depending on
    // which module Nest happens to construct first.
    forwardRef(() => SchoolsModule),
  ],
  providers: [
    FeeStructureService,
    PaymentService,
    PaymentsQueryService,
    FeeGenerationService,
    PaymentAllocationService,
    FeeDuesService,
    FeeGenerationsService,
    FeeGenerationBatchService,
    RecurringSchedulesService,
    WalletService,
    // [16.7.3] `DiscountRulesService` implements the `DiscountResolver`
    // interface `NoopDiscountResolver` stubbed out — same DI token, real
    // class, so `FeeGenerationService`'s constructor (typed
    // `NoopDiscountResolver`) resolves the real thing without changing.
    DiscountRulesService,
    { provide: NoopDiscountResolver, useExisting: DiscountRulesService },
    CheckoutCartService,
    CheckoutService,
    PaymentReversalService,
    // [16.7.4] Registering this provider is what fills the `@Optional()
    // lateFeeService?` seam `fees-daily.scheduler.ts` ([16.7.2]/#676) left
    // for this ticket — Nest resolves it into that constructor parameter
    // automatically once it's a real provider in this module.
    LateFeeService,
    FeesDailyScheduler,
  ],
  // CheckoutController is registered before FeeController: both declare
  // routes under `payments/*`, and Nest/Express match routes in
  // registration order. `CheckoutController`'s `payments/cart` and
  // `payments/checkout` are literal segments that `FeeController`'s
  // `payments/:id` (GET, 16.4.3) would otherwise shadow (`:id` matches any
  // single segment, including "cart"/"checkout") if FeeController's routes
  // registered first.
  controllers: [
    CheckoutController,
    FeeController,
    FeeGenerationsController,
    RecurringSchedulesController,
    WalletController,
    DiscountRulesController,
  ],
  exports: [
    FeeStructureService,
    PaymentService,
    PaymentsQueryService,
    FeeGenerationService,
    PaymentAllocationService,
    FeeDuesService,
    FeeGenerationsService,
    FeeGenerationBatchService,
    RecurringSchedulesService,
    WalletService,
    CheckoutCartService,
  ],
})
export class FeeModule {}
