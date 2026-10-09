import { IsNotEmpty, IsDateString, IsOptional, IsUUID } from 'class-validator';
import type { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';

/**
 * One row of a homework bulk-upload spreadsheet, after empty cells have
 * been normalized to `undefined` (see HomeworkBulkUploadService.toDtoInput).
 * Mirrors students/dto/students.dto.ts's BulkUploadRowDto conventions.
 */
export class HomeworkBulkUploadRowDto {
  @IsNotEmpty({ message: 'Missing required field: class' })
  class: string;

  @IsNotEmpty({ message: 'Missing required field: section' })
  section: string;

  @IsNotEmpty({ message: 'Missing required field: subject' })
  subject: string;

  @IsNotEmpty({ message: 'Missing required field: assigned_date' })
  @IsDateString({}, { message: 'assigned_date must be a valid date (YYYY-MM-DD)' })
  assigned_date: string;

  @IsNotEmpty({ message: 'Missing required field: due_date' })
  @IsDateString({}, { message: 'due_date must be a valid date (YYYY-MM-DD)' })
  due_date: string;

  @IsOptional()
  description?: string;
}

export class HomeworkBulkUploadErrorDto {
  row: number;
  /** Spreadsheet column the problem sits in (e.g. `class`, `section`,
   * `subject`, `assigned_date`, `due_date`). Absent for a row-level error. */
  field?: string;
  /** The offending cell's raw value. Absent when there is no single culprit. */
  value?: string;
  reason: string;
}

export class HomeworkBulkUploadResultDto {
  total_rows: number;
  success_count: number;
  error_count: number;
  created_homework_ids: string[];
  errors: HomeworkBulkUploadErrorDto[];
}

/** One accepted row, shown so the caller can eyeball the shape before committing. */
export class HomeworkBulkUploadPreviewRowDto {
  row: number;
  class: string;
  section: string;
  subject: string;
  assigned_date: string;
  due_date: string;
}

/** Response of `POST /homework/bulk/validate`. Nothing has been written yet. */
export class HomeworkBulkUploadValidateResultDto {
  staging_id: string;
  expires_at: string;
  rows_to_create: number;
  preview: HomeworkBulkUploadPreviewRowDto[];
  errors: BulkImportErrorDto[];
  hard_error_count: number;
}

/** Body of `POST /homework/bulk/commit`. */
export class CommitHomeworkBulkUploadDto {
  @IsUUID('4', { message: 'staging_id must be a valid id' })
  @IsNotEmpty({ message: 'Missing required field: staging_id' })
  staging_id: string;
}
