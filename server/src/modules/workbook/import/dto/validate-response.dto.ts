import { ApiProperty } from '@nestjs/swagger';
import { BulkImportErrorDto, StagingRefDto } from '../../../bulk-import/dto/bulk-import.dto';

/** One tab's dry-run preview: what applying the workbook would change. */
export class TabSummaryDto {
  @ApiProperty({ description: 'Tab/sheet name, e.g. "school"' })
  name: string;

  @ApiProperty({ description: 'False when the workbook had no sheet for this tab' })
  present: boolean;

  @ApiProperty() creates: number;
  @ApiProperty() updates: number;
  @ApiProperty() unchanged: number;
  @ApiProperty() deletes: number;
}

export class ValidateTotalsDto {
  @ApiProperty() creates: number;
  @ApiProperty() updates: number;
  @ApiProperty() unchanged: number;
  @ApiProperty() deletes: number;
}

/** Response of `POST /backup/validate`. Nothing has been written yet. */
export class ValidateResponseDto extends StagingRefDto {
  @ApiProperty({ description: 'The workbook `_meta` sheet, echoed back for display' })
  meta: {
    schema_version: number;
    kind: string;
    exported_at: string;
    app_version: string;
    source_school_name: string;
    source_school_slug: string;
  };

  @ApiProperty({ type: [TabSummaryDto] })
  tabs: TabSummaryDto[];

  @ApiProperty({ type: ValidateTotalsDto })
  totals: ValidateTotalsDto;

  @ApiProperty({ type: [BulkImportErrorDto] })
  errors: BulkImportErrorDto[];

  @ApiProperty({
    type: [BulkImportErrorDto],
    description:
      'Non-fatal notices. Includes "sheet <tab> not present", which means delete-by-absence is skipped for that tab.',
  })
  warnings: BulkImportErrorDto[];

  @ApiProperty({
    description: 'Total error count, which can exceed errors.length once capped at 1,000',
  })
  hard_error_count: number;

  @ApiProperty({
    description:
      'True when every present tab except `school` currently has zero rows in this tenant',
  })
  is_empty_tenant: boolean;
}
