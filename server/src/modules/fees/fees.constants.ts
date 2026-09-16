/** [16.7.2] Queue that runs the daily recurring-fees sweep. */
export const FEES_DAILY_QUEUE = 'fees-daily';

/** `upsertJobScheduler` id — same value every boot, so re-registering on
 * restart dedupes instead of piling up duplicate repeatable jobs. */
export const FEES_DAILY_JOB_ID = 'fees-daily-run-schedules';

/** 00:30 in `SCHOOL_TZ` (`server/src/common/time.ts`), daily. */
export const FEES_DAILY_CRON = '30 0 * * *';
