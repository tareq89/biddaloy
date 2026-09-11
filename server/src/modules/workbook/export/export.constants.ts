import {
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
  WorkbookRowCounts,
} from '../jobs/workbook-job.entity';

export const WORKBOOK_EXPORT_QUEUE = 'workbook-export';
export const WORKBOOK_EXPORT_JOB = 'export';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const BACKUP_STORAGE_CATEGORY = 'backups';
export const EXPORT_RETENTION_DAYS = 30;

/** Node `events` name (not `@nestjs/event-emitter`, which isn't installed —
 * see the plan's correction C1). [14.7.3] (#601) subscribes to this via
 * `WorkbookJobEventsService.onFinished`. */
export const WORKBOOK_JOB_FINISHED = 'workbook-job.finished';

/**
 * BullMQ payload. Deliberately only the ids: every other field is re-read
 * from the row, so a retry can never act on a stale copy.
 */
export interface WorkbookExportJobData {
  jobId: string;
  tenantId: string;
}

/**
 * Full snapshot handed to `WORKBOOK_JOB_FINISHED` listeners so a consumer
 * (e.g. a notifier) can act without a second DB read. Emitted for both
 * DONE and FAILED outcomes — `status` tells which.
 */
export interface WorkbookJobFinishedPayload {
  jobId: string;
  tenantId: string;
  kind: WorkbookJobKind;
  source: WorkbookJobSource;
  status: WorkbookJobStatus.DONE | WorkbookJobStatus.FAILED;
  requestedByUserId: string | null;
  storageKey: string | null;
  sizeBytes: string | null;
  rowCounts: WorkbookRowCounts | null;
  error: string | null;
}
