import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsUUID } from 'class-validator';
import { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';

export class StaffImportPreviewRowDto {
  row: number;
  name: string;
  mobile?: string;
  email?: string;
  role: string;
  designation?: string;
  @ApiProperty({ enum: ['create', 'restore', 'skip'] })
  action: 'create' | 'restore' | 'skip';
  /** Non-blocking remarks, e.g. "Already a member — skipped". */
  notes: string[];
}

export class StaffImportValidateResultDto {
  staging_id: string;
  expires_at: string;
  summary: { create: number; restore: number; skip: number };
  rows: StaffImportPreviewRowDto[];
  errors: BulkImportErrorDto[];
  hard_error_count: number;
}

export class StaffImportCommitDto {
  @IsUUID('4', { message: 'staging_id must be a valid id' })
  @IsNotEmpty({ message: 'Missing required field: staging_id' })
  staging_id: string;

  @IsBoolean()
  send_invitations: boolean;
}

export class StaffImportResultDto {
  created: number;
  restored: number;
  skipped: number;
  invited: number;
  failed: { row: number; reason: string }[];
  /** Members created whose invitation did not go out. */
  invite_failed: { row: number; reason: string }[];
}
