import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeeStructure } from './entities/fee-structure.entity';
import { FeeStructureStudent } from './entities/fee-structure-student.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { AuditModule } from '../audit/audit.module';
import { FeeStructureService, PaymentService } from './fees.service';
import { FeeGenerationService } from './fee-generation.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { FeeDuesService } from './fee-dues.service';
import { FeeController } from './fees.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeStructure, FeeStructureStudent, Payment, PaymentAllocation, StudentFee, Student,
      Class, ClassSection, AcademicYear, Invoice,
    ]),
    AuditModule,
  ],
  providers: [FeeStructureService, PaymentService, FeeGenerationService, PaymentAllocationService, FeeDuesService],
  controllers: [FeeController],
  exports: [FeeStructureService, PaymentService, FeeGenerationService, PaymentAllocationService, FeeDuesService],
})
export class FeeModule {}