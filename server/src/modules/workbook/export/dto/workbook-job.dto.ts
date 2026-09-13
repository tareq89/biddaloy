import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobProgress,
  WorkbookJobSource,
  WorkbookJobStatus,
  WorkbookRowCounts,
} from '../../jobs/workbook-job.entity';

export class RequestExportDto {
  /** Only EXPORT and SNAPSHOT; RESTORE is rejected by ExportService. */
  @IsOptional()
  @IsIn([WorkbookJobKind.EXPORT, WorkbookJobKind.SNAPSHOT])
  kind?: WorkbookJobKind.EXPORT | WorkbookJobKind.SNAPSHOT = WorkbookJobKind.EXPORT;
}

export class RequestExportResponseDto {
  job_id: string;
}

export class QueryWorkbookJobsDto {
  @IsOptional()
  @IsEnum(WorkbookJobKind)
  kind?: WorkbookJobKind;

  @IsOptional()
  @IsEnum(WorkbookJobStatus)
  status?: WorkbookJobStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class WorkbookJobRequesterDto {
  id: string;
  full_name: string;
}

export class WorkbookJobDto {
  id: string;
  kind: WorkbookJobKind;
  status: WorkbookJobStatus;
  source: WorkbookJobSource;
  requested_by: WorkbookJobRequesterDto | null;
  // bigint column — see the plan's correction C2. Never `Number()` this.
  size_bytes: string | null;
  row_counts: WorkbookRowCounts | null;
  progress: WorkbookJobProgress | null;
  failed_tab: string | null;
  snapshot_job_id: string | null;
  error: string | null;
  pinned: boolean;
  expires_at: Date | null;
  created_at: Date;
  finished_at: Date | null;
}

export class WorkbookJobListResponseDto {
  data: WorkbookJobDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Sum of `size_bytes` over every DONE, still-stored job for the tenant —
   * bigint, hence a string (see `size_bytes`'s own comment). Drives the
   * storage-cap UI (14.12.2, `STORAGE_CAP_BYTES` = 500 MB). */
  storage_total_bytes: string;
}

export class PinWorkbookJobDto {
  @IsBoolean()
  pinned: boolean;
}

/** Never expose `storage_key`, `staging_id` or `tenant_id` — the storage
 * key is an internal bucket path the client has no business seeing (same
 * rule as `logo.controller.ts`'s "never exposes the storage key or bucket"). */
export function toWorkbookJobDto(job: WorkbookJob): WorkbookJobDto {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    source: job.source,
    requested_by: job.requested_by
      ? { id: job.requested_by.id, full_name: job.requested_by.full_name }
      : null,
    size_bytes: job.size_bytes,
    row_counts: job.row_counts,
    progress: job.progress,
    failed_tab: job.failed_tab,
    snapshot_job_id: job.snapshot_job_id,
    error: job.error,
    pinned: job.pinned,
    expires_at: job.expires_at,
    created_at: job.created_at,
    finished_at: job.finished_at,
  };
}

const SLUG_SANITIZE_RE = /[^a-z0-9-]/g;

/** Builds the download filename from `School.slug` (via the `tenant`
 * relation) and the job row — the storage key carries neither, see the
 * plan's correction C4. Sanitising the slug is not cosmetic: it is what
 * keeps a CR/LF or a `"` out of the `Content-Disposition` header. */
export function buildDownloadFilename(job: WorkbookJob): string {
  const rawSlug = job.tenant?.slug ?? '';
  const slug =
    rawSlug
      .toLowerCase()
      .replace(SLUG_SANITIZE_RE, '-')
      .replace(/^-+|-+$/g, '') || 'backup';
  const kind = job.kind.toLowerCase();
  const ts = (job.finished_at ?? job.created_at).toISOString();
  // YYYYMMDD-HHmm in UTC, deterministic regardless of server TZ.
  const timestamp = `${ts.slice(0, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-${ts.slice(11, 13)}${ts.slice(14, 16)}`;
  return `${slug}-${kind}-${timestamp}.xlsx`;
}
