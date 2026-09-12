import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { School } from '../../schools/entities/school.entity';
import { AuditModule } from '../../audit/audit.module';
import { BulkImportModule } from '../../bulk-import/bulk-import.module';
import { ExportModule } from '../export/export.module';
import { WORKBOOK_RESTORE_QUEUE } from './restore.constants';
import { RestoreService } from './restore.service';

/**
 * Concurrency 1 for the restore worker belongs on the worker (14.10.2),
 * not on this queue registration — see the plan's correction/approach.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkbookJob, School]),
    AuditModule,
    BulkImportModule,
    ExportModule,
    BullModule.registerQueue({ name: WORKBOOK_RESTORE_QUEUE }),
  ],
  providers: [RestoreService],
  exports: [RestoreService],
})
export class RestoreModule {}
