import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceShareToken } from './entities/invoice-share-token.entity';
import { Payment } from '../fees/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { AuditModule } from '../audit/audit.module';
import { StudentModule } from '../students/students.module';
import { StorageModule } from '../storage/storage.module';
import { InvoicesService } from './invoices.service';
import { InvoiceShareService } from './invoice-share.service';
import { InvoicesController } from './invoices.controller';
import { PublicInvoiceController } from './public-invoice.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceShareToken, Payment, School]),
    AuditModule,
    StudentModule,
    // [15.5.7] The printable invoice inlines the issuer logo bytes.
    StorageModule,
  ],
  providers: [InvoicesService, InvoiceShareService],
  controllers: [InvoicesController, PublicInvoiceController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
