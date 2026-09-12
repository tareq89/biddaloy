export const WORKBOOK_RESTORE_QUEUE = 'workbook-restore';
export const WORKBOOK_RESTORE_JOB = 'restore';

/** Seconds a per-tenant restore lock is held before it auto-expires. A
 * stuck lock (process crash between acquire and release) must not lock
 * the tenant out forever. */
export const RESTORE_LOCK_TTL_SEC = 3600;

/**
 * BullMQ payload. Deliberately only ids and the one flag the processor
 * cannot re-derive: every other field is re-read from the row, so a
 * retry can never act on a stale copy.
 */
export interface RestoreJobData {
  jobId: string;
  inviteUsers: boolean;
}
