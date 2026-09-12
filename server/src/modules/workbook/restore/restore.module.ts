import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { School } from '../../schools/entities/school.entity';
import { AuditModule } from '../../audit/audit.module';
import { BulkImportModule } from '../../bulk-import/bulk-import.module';
import { StorageModule } from '../../storage/storage.module';
import { ExportModule } from '../export/export.module';
import { ValidationService } from '../import/validation.service';
import { WORKBOOK_RESTORE_QUEUE } from './restore.constants';
import { RestoreService } from './restore.service';
import { RestoreProcessor } from './restore.processor';

/**
 * Concurrency 1 for the restore worker (14.10.2's `RestoreProcessor`) is
 * declared on the `@Processor` decorator itself, not on this queue
 * registration — see the plan's correction/approach.
 *
 * `ValidationService` is provided directly here rather than imported from
 * `ImportModule`: that module does not export it, and this ticket's
 * territory is restricted to `restore/**`, so extending `ImportModule`'s
 * exports is out of bounds. `ValidationService` has no constructor
 * dependencies of its own, so redeclaring it as a provider here is safe —
 * NestJS gives each module its own instance, which is fine since the
 * service is stateless.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkbookJob, School]),
    AuditModule,
    BulkImportModule,
    StorageModule,
    ExportModule,
    BullModule.registerQueue({ name: WORKBOOK_RESTORE_QUEUE }),
  ],
  providers: [RestoreService, RestoreProcessor, ValidationService],
  exports: [RestoreService],
})
export class RestoreModule {}
