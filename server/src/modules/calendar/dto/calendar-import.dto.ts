import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { CalendarAudience, CalendarEventType, CalendarImportRowStatus } from '@biddaloy/shared';
import { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';

/** `POST /calendar-import/commit` body. `staging_id` comes from the
 * preceding `POST /calendar-import/validate` call and is single-use —
 * `ImportStagingService.consume` deletes it on read, so replaying the same
 * `staging_id` twice fails with a 404, not a duplicate commit. */
export class CommitCalendarImportDto {
  @IsUUID()
  staging_id: string;

  /** Defaults to `false` — imported rows land as drafts unless the caller
   * explicitly opts into publishing them immediately (issue body's D9). */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/** One parsed-and-validated spreadsheet row, before it's matched against
 * existing `CalendarEvent`s to decide `NEW`/`UPDATED`/`UNCHANGED`. Produced
 * by the pure `calendar-import-rows.util.ts` — it never touches the
 * database, so it knows class *names*, never class ids. */
export interface ParsedCalendarImportRow {
  type: CalendarEventType;
  name: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  counts_as_working_day: boolean;
  audience: CalendarAudience;
  class_names: string[];
  description: string | null;
}

/** Result of validating one spreadsheet row: either a parsed draft, or a
 * list of row-level errors (in which case `row` is `null`). */
export interface CalendarImportRowResult {
  rowNumber: number;
  row: ParsedCalendarImportRow | null;
  errors: BulkImportErrorDto[];
}

/** The staged payload `ImportStagingService` holds between `validate` and
 * `commit` — a status-tagged, DB-resolved version of every row, keyed to
 * the tenant/user pair that validated it (enforced by `ImportStagingService`
 * itself, not by anything in this module). */
export interface StagedCalendarImportRow {
  rowNumber: number;
  status: CalendarImportRowStatus;
  errors: BulkImportErrorDto[];
  /** `null` for an `ERROR` row. */
  draft: {
    type: CalendarEventType;
    name: string;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    counts_as_working_day: boolean;
    audience: CalendarAudience;
    class_ids: string[];
    description: string | null;
  } | null;
  /** Set when `status` is `UPDATED`/`UNCHANGED` — the existing event this
   * row matched by `(name, start_date)`. */
  existing_event_id: string | null;
}

export interface StagedCalendarImport {
  rows: StagedCalendarImportRow[];
}

export class CalendarImportSummaryDto {
  @ApiProperty() new: number;
  @ApiProperty() updated: number;
  @ApiProperty() unchanged: number;
  @ApiProperty() error: number;
}

export class CalendarImportRowResponseDto {
  @ApiProperty() row: number;
  @ApiProperty({ enum: CalendarImportRowStatus }) status: CalendarImportRowStatus;
  @ApiProperty({ type: BulkImportErrorDto, isArray: true }) errors: BulkImportErrorDto[];
}

export class CalendarImportValidateResponseDto {
  @ApiProperty({ description: 'Opaque id — pass to `POST /calendar-import/commit` to apply.' })
  staging_id: string;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;

  @ApiProperty({ type: CalendarImportSummaryDto })
  summary: CalendarImportSummaryDto;

  @ApiProperty({ type: CalendarImportRowResponseDto, isArray: true })
  rows: CalendarImportRowResponseDto[];
}

export class CalendarImportCommitFailedRowDto {
  @ApiProperty() row: number;
  @ApiProperty() message: string;
}

export class CalendarImportCommitResponseDto {
  @ApiProperty() created: number;
  @ApiProperty() updated: number;
  @ApiProperty() unchanged: number;

  /** Rows that failed at commit time (rare — see `CalendarImportCommitResult`
   * doc comment). Non-empty means a partial commit: fix these and
   * re-upload the same file, already-committed rows won't be duplicated. */
  @ApiProperty({ type: CalendarImportCommitFailedRowDto, isArray: true })
  failed: CalendarImportCommitFailedRowDto[];
}

export class CalendarImportTemplateQueryDto {
  @ApiPropertyOptional({ enum: ['xlsx', 'csv'], default: 'xlsx' })
  @IsOptional()
  format?: 'xlsx' | 'csv';
}
