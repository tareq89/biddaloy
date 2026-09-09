export const INVITATION_BATCH_QUEUE = 'invitation-batch';

/**
 * Cap on one batch (12.6) — the preview/dispatch endpoints resolve
 * recipients inside the request; an unbounded list would make a single
 * call scan/enqueue tens of thousands of rows. Same shape as
 * `MAX_BULK_REMINDER_STUDENTS` in `reminders.dto.ts`.
 */
export const MAX_BATCH_INVITE_SELECTION = 1000;
