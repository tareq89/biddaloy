import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Shared response shapes for every bulk-upload "validate" endpoint. Other
// 14.3 lanes (workbook parsing, student import, etc.) import these rather
// than redeclaring their own row-error / staging-ref DTOs, so the shape
// every bulk import endpoint returns stays consistent across domains.

export class BulkImportErrorDto {
  @ApiProperty({ description: '1-based row number in the source sheet the error applies to' })
  row: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Column the error applies to, or null for a row-level error',
  })
  column: string | null;

  @ApiProperty({ description: 'Human-readable description of the problem' })
  message: string;

  @ApiProperty({ enum: ['error', 'warning'] })
  severity: 'error' | 'warning';

  @ApiPropertyOptional({ description: 'Offending cell value, when available' })
  value?: string;

  @ApiPropertyOptional({ description: 'Sheet/tab name the row was found on, for multi-tab workbooks' })
  tab?: string;
}

export class StagingRefDto {
  @ApiProperty({ description: 'Opaque id referencing the staged, validated payload' })
  staging_id: string;

  @ApiProperty({ format: 'date-time', description: 'ISO 8601 timestamp the staged payload expires at' })
  expires_at: string;
}
