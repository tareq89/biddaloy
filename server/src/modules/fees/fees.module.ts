import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
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
import { FeeStructureService, PaymentService } from './fees.service';
import { PaymentsQueryService } from './payments-query.service';
import { FeeGenerationService, NoopDiscountResolver } from './fee-generation.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { FeeDuesService } from './fee-dues.service';
import { FeeGenerationsService } from './fee-generations.service';
import { FeeGenerationBatchService } from './fee-generation-batch.service';
import { FeeController } from './fees.controller';
import { FeeGenerationsController } from './fee-generations.controller';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { CheckoutCartService } from './checkout-cart.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeStructure,
      Payment,
      PaymentAllocation,
      StudentFee,
      FeeGeneration,
      StudentWallet,
      WalletTransaction,
      Student,
      Class,
      ClassSection,
      AcademicYear,
      Invoice,
      School,
    ]),
    AuditModule,
    StudentModule,
    InvoicesModule,
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
    WalletService,
    NoopDiscountResolver,
    CheckoutCartService,
    CheckoutService,
  ],
  // CheckoutController is registered before FeeController: both declare
  // routes under `payments/*`, and Nest/Express match routes in
  // registration order. `CheckoutController`'s `payments/cart` and
  // `payments/checkout` are literal segments that `FeeController`'s
  // `payments/:id` (GET, 16.4.3) would otherwise shadow (`:id` matches any
  // single segment, including "cart"/"checkout") if FeeController's routes
  // registered first.
  controllers: [CheckoutController, FeeController, FeeGenerationsController, WalletController],
  exports: [
    FeeStructureService,
    PaymentService,
    PaymentsQueryService,
    FeeGenerationService,
    PaymentAllocationService,
    FeeDuesService,
    FeeGenerationsService,
    FeeGenerationBatchService,
    WalletService,
    CheckoutCartService,
  ],
})
export class FeeModule {}
