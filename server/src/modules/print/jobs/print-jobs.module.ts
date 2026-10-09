import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { StorageModule } from '../../storage/storage.module';
import { SchoolsModule } from '../../schools/schools.module';
import { CertificatesController } from './certificates.controller';
import { PrintJobsController } from './print-jobs.controller';
import { PrintJobActionsController, PrintHistoryController } from './print-history.controller';
import { PrintTemplatesModule } from '../templates/print-templates.module';
import { PrintersModule } from '../printers/printers.module';
import { PrintAssetsModule } from '../assets/print-assets.module';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryService } from './print-history.service';
import { PublicVerifyController } from '../verify/public-verify.controller';
import { PublicVerifyService } from '../verify/public-verify.service';

/** Resolvers are plain classes reached through `RESOLVERS`; only the services need DI. Wired into the app in 32.2.9. */
@Module({
  imports: [
    AuditModule,
    StorageModule,
    SchoolsModule,
    PrintTemplatesModule,
    PrintersModule,
    PrintAssetsModule,
  ],
  controllers: [
    PrintJobsController,
    CertificatesController,
    PrintJobActionsController,
    PrintHistoryController,
    PublicVerifyController,
  ],
  providers: [PrintJobsService, PrintHistoryService, PublicVerifyService],
  exports: [PrintJobsService, PrintHistoryService],
})
export class PrintJobsModule {}
