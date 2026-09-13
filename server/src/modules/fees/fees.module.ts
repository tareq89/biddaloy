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
import { FeeStructureService, PaymentService } from './fees.service';
import { FeeGenerationService, NoopDiscountResolver } from './fee-generation.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { FeeDuesService } from './fee-dues.service';
import { FeeGenerationsService } from './fee-generations.service';
import { FeeController } from './fees.controller';
import { FeeGenerationsController } from './fee-generations.controller';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

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
  ],
  providers: [
    FeeStructureService,
    PaymentService,
    FeeGenerationService,
    PaymentAllocationService,
    FeeDuesService,
    FeeGenerationsService,
    WalletService,
    NoopDiscountResolver,
  ],
  controllers: [FeeController, FeeGenerationsController, WalletController],
  exports: [
    FeeStructureService,
    PaymentService,
    FeeGenerationService,
    PaymentAllocationService,
    FeeDuesService,
    FeeGenerationsService,
    WalletService,
  ],
})
export class FeeModule {}
