import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Student } from '../students/entities/student.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { Payment } from '../fees/entities/payment.entity';
import { AuditModule } from '../audit/audit.module';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Student, StudentFee, Payment]), AuditModule],
  providers: [InvoicesService],
  controllers: [InvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
