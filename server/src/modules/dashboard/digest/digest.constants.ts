export const DASHBOARD_DIGEST_QUEUE = 'dashboard-digest';
export const DIGEST_RUN_JOB = 'dashboard-digest-run';
export const DIGEST_RECONCILE_JOB = 'dashboard-digest-reconcile';
export const DIGEST_RECONCILE_ID = 'dashboard-digest-reconcile';
export const DIGEST_RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
export const DIGEST_RECONCILE_RETRY_MS = 60 * 1000;
/** Per school per local day: the run claims this key before sending, so a re-run sends nothing. */
export const DIGEST_SENT_TTL_SECONDS = 2 * 86_400;

/** Hyphen, not colon: BullMQ splits scheduler keys on ':'. */
export const digestSchedulerIdFor = (tenantId: string) => `dashboard-digest-${tenantId}`;
export const digestSentKey = (tenantId: string, localDate: string) =>
  `tenant:${tenantId}:digest:sent:${localDate}`;

export interface DigestJobData {
  tenantId: string;
  /** Set by the quiet-hours delay: run now, do not re-check quiet hours. */
  deferred?: boolean;
  /** School-local day (YYYY-MM-DD) a quiet-hours-deferred run was scheduled for. */
  scheduledDate?: string;
}
