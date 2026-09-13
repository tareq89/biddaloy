export const BACKUP_SCHEDULE_QUEUE = 'workbook-backup-schedule';
export const BACKUP_SCHEDULE_RUN_JOB = 'backup-schedule-run';
export const BACKUP_SCHEDULE_RECONCILE_JOB = 'backup-schedule-reconcile';
export const BACKUP_SCHEDULE_RECONCILE_ID = 'backup-schedule-reconcile';
export const BACKUP_SCHEDULE_RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
/** How long `BackupScheduleProcessor` waits before re-attempting to
 * register the reconcile scheduler after a failed `upsertJobScheduler` at
 * boot. */
export const BACKUP_SCHEDULE_RECONCILE_RETRY_MS = 60 * 1000;

export const BACKUP_SCHEDULE_CRON: Record<'WEEKLY' | 'DAILY', string> = {
  WEEKLY: '0 2 * * 0',
  DAILY: '0 2 * * *',
};

/** Hyphen, not colon: BullMQ splits scheduler keys on ':' — see plan
 * correction C5 on #615. */
export const schedulerIdFor = (tenantId: string) => `backup-schedule-${tenantId}`;

export interface BackupScheduleJobData {
  tenantId: string;
}
