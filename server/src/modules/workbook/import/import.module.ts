import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { ImportController } from './import.controller';
import { ValidationService } from './validation.service';
import { DiffService } from './diff.service';

/**
 * `POST /backup/validate` and its error-CSV download.
 *
 * `ImportStagingService` is not listed here: `BulkImportModule` is
 * `@Global()` (see `bulk-import.module.ts`), so it is already available
 * everywhere without an explicit import. `StorageModule` is imported
 * explicitly: the controller persists the uploaded workbook there so a
 * later restore can re-validate it (see `StagedValidation`'s doc comment).
 */
@Module({
  imports: [StorageModule],
  controllers: [ImportController],
  providers: [ValidationService, DiffService],
})
export class ImportModule {}
