import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { StorageModule } from '../../storage/storage.module';
import { PrintJobsController } from './print-jobs.controller';
import { PrintJobActionsController, PrintHistoryController } from './print-history.controller';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryService } from './print-history.service';
import { PublicVerifyController } from '../verify/public-verify.controller';
import { PublicVerifyService } from '../verify/public-verify.service';

/** Resolvers are plain classes reached through `RESOLVERS`; only the services need DI. Wired into the app in 32.2.9. */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [
    PrintJobsController,
    PrintJobActionsController,
    PrintHistoryController,
    PublicVerifyController,
  ],
  providers: [PrintJobsService, PrintHistoryService, PublicVerifyService],
})
export class PrintJobsModule {}
