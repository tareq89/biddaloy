import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceShareToken } from './entities/invoice-share-token.entity';
import { Payment } from '../fees/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { AuditModule } from '../audit/audit.module';
import { StudentModule } from '../students/students.module';
import { StorageModule } from '../storage/storage.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { SchoolsModule } from '../schools/schools.module';
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
    // [16.5.4] `InvoicesController.sendInvoice` needs `CommunicationsService`.
    // `CommunicationsModule` imports this module back (for
    // `InvoiceNotificationsListener`'s `InvoiceShareService` dependency), so
    // this edge needs `forwardRef` too.
    forwardRef(() => CommunicationsModule),
    CreditsModule,
    // [16.5.4] `sendInvoice` needs the tenant's resolved locale for the
    // receipt message. Part of the same cycle as `CommunicationsModule`
    // above (`SchoolsModule` -> `AccountAccessModule` -> `CommunicationsModule`
    // -> `InvoicesModule`), already broken by that edge's `forwardRef`.
    SchoolsModule,
  ],
  providers: [InvoicesService, InvoiceShareService],
  controllers: [InvoicesController, PublicInvoiceController],
  exports: [InvoicesService, InvoiceShareService],
})
export class InvoicesModule {}
