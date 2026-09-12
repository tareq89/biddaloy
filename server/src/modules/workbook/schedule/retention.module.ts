import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { StorageModule } from '../../storage/storage.module';
import { AuditModule } from '../../audit/audit.module';
import { RetentionService } from './retention.service';

/**
 * [14.12.2] Standalone module (not folded into `BackupScheduleModule`)
 * because `BackupScheduleModule` already imports `ExportModule`, and
 * `ExportModule` needs `RetentionService` in `ExportProcessor` — importing
 * `BackupScheduleModule` from `ExportModule` would create a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WorkbookJob]), StorageModule, AuditModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
