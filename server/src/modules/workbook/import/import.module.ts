import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ValidationService } from './validation.service';
import { DiffService } from './diff.service';

/**
 * `POST /backup/validate` and its error-CSV download.
 *
 * `ImportStagingService` is not listed here: `BulkImportModule` is
 * `@Global()` (see `bulk-import.module.ts`), so it is already available
 * everywhere without an explicit import.
 */
@Module({
  controllers: [ImportController],
  providers: [ValidationService, DiffService],
})
export class ImportModule {}
