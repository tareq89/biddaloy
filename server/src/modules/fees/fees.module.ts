import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeeStructure } from './entities/fee-structure.entity';
import { FeeStructureStudent } from './entities/fee-structure-student.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { FeeStructureService, PaymentService } from './fees.service';
import { FeeController } from './fees.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    FeeStructure, FeeStructureStudent, Payment, PaymentAllocation, StudentFee, Student,
  ])],
  providers: [FeeStructureService, PaymentService],
  controllers: [FeeController],
  exports: [FeeStructureService, PaymentService],
})
export class FeeModule {}