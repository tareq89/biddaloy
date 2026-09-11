import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { StorageModule } from '../../storage/storage.module';
import { AuditModule } from '../../audit/audit.module';
import { AccountAccessModule } from '../../account-access/account-access.module';
import { SchoolsModule } from '../../schools/schools.module';
import { WORKBOOK_EXPORT_QUEUE } from './export.constants';
import { ExportService } from './export.service';
import { ExportProcessor } from './export.processor';
import { WorkbookJobEventsService } from './workbook-job-events.service';
import { WorkbookNotifier } from './workbook-notifier';
import { WorkbookController } from './workbook.controller';

/**
 * `WorkbookModule` is deliberately not imported here — it is `@Module({})`
 * with no providers and only calls `assertRegistryValid` from its own
 * constructor (see the plan's correction C3). This module imports the
 * codec functions (`writeWorkbook`, `ALL_TABS`) directly instead.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkbookJob]),
    StorageModule,
    AuditModule,
    AccountAccessModule,
    SchoolsModule,
    ConfigModule,
    BullModule.registerQueue({
      name: WORKBOOK_EXPORT_QUEUE,
      // `removeOnFail` matches the other queues in this codebase
      // (absence-notice, refresh-token-cleanup): BullMQ keeps failed
      // jobs forever by default, so without a cap the failed set grows
      // unbounded in Redis — one entry per permanently-failed export,
      // per tenant, never trimmed.
      defaultJobOptions: { attempts: 2, removeOnComplete: true, removeOnFail: 100 },
    }),
  ],
  controllers: [WorkbookController],
  providers: [ExportService, ExportProcessor, WorkbookJobEventsService, WorkbookNotifier],
  exports: [ExportService, WorkbookJobEventsService],
})
export class ExportModule {}
