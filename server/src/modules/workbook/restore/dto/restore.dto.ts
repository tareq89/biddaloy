import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class RequestRestoreDto {
  @IsUUID()
  staging_id: string;

  /** Must equal the school's exact name — `RestoreService.request` checks
   * this and never echoes the expected value back on mismatch. */
  @IsString()
  confirmation: string;

  @IsOptional()
  @IsBoolean()
  invite_users?: boolean;
}

export class RequestRestoreResponseDto {
  job_id: string;
  /** The pre-restore safety copy, so the client can offer "download the
   * snapshot" alongside the restore progress. */
  snapshot_job_id: string;
}
