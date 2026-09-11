import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { StorageModule } from '../../storage/storage.module';
import { AuditModule } from '../../audit/audit.module';
import { WORKBOOK_EXPORT_QUEUE } from './export.constants';
import { ExportService } from './export.service';
import { ExportProcessor } from './export.processor';
import { WorkbookJobEventsService } from './workbook-job-events.service';
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
    BullModule.registerQueue({
      name: WORKBOOK_EXPORT_QUEUE,
      defaultJobOptions: { attempts: 2, removeOnComplete: true },
    }),
  ],
  controllers: [WorkbookController],
  providers: [ExportService, ExportProcessor, WorkbookJobEventsService],
  exports: [ExportService, WorkbookJobEventsService],
})
export class ExportModule {}
