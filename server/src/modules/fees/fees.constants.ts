import { FeeStatus } from '@biddaloy/shared';

/** [16.7.2] Queue that runs the daily recurring-fees sweep. */
export const FEES_DAILY_QUEUE = 'fees-daily';

/** `upsertJobScheduler` id — same value every boot, so re-registering on
 * restart dedupes instead of piling up duplicate repeatable jobs. */
export const FEES_DAILY_JOB_ID = 'fees-daily-run-schedules';

/** [68.1.fix] How long a school skipped for a running restore waits before its catch-up run. */
export const FEES_DAILY_RESTORE_RETRY_MS = 15 * 60 * 1000;

/** 00:30 in `SCHOOL_TZ` (`server/src/common/time.ts`), daily. */
export const FEES_DAILY_CRON = '30 0 * * *';

/** Bills that still owe money: dues list and checkout cart must agree on this set. */
export const OPEN_FEE_STATUSES = [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID, FeeStatus.OVERDUE];
