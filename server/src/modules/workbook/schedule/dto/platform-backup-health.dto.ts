import { BackupScheduleMode } from '@biddaloy/shared';
import { WorkbookJobStatus } from '../../jobs/workbook-job.entity';

/**
 * [14.12.3] One row of `GET /platform/backups/health` — per school,
 * enough for a SUPER_ADMIN to see who is and isn't backed up.
 *
 * `last_status` is the outcome of the most recent EXPORT job attempt only
 * — a SNAPSHOT (RestoreService's internal pre-restore safety copy) is not
 * itself a "backup" this table reports on, though it still counts toward
 * `storage_total_bytes` (may be `FAILED` even if an earlier attempt succeeded);
 * `last_success_at` is independently the finish time of the most recent
 * *DONE* one — the two can disagree (most recent attempt failed, but an
 * older backup still exists) and the UI must show both, not collapse them
 * into one. Both are `null` for a school that has never attempted a
 * backup at all ("never" row).
 */
export class PlatformSchoolBackupHealthDto {
  school_id: string;
  name: string;
  schedule: BackupScheduleMode;
  last_success_at: Date | null;
  last_status: WorkbookJobStatus | null;
  // bigint sum — string, same reasoning as WorkbookJobDto.size_bytes.
  storage_total_bytes: string;
}

export class PlatformBackupHealthResponseDto {
  data: PlatformSchoolBackupHealthDto[];
}
