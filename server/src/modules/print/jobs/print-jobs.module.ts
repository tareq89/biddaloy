import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { StorageModule } from '../../storage/storage.module';
import { PrintJobsController } from './print-jobs.controller';
import { PrintJobsService } from './print-jobs.service';

/** Resolvers are plain classes reached through `RESOLVERS`; only the service needs DI. Wired into the app in 32.2.9. */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [PrintJobsController],
  providers: [PrintJobsService],
})
export class PrintJobsModule {}
