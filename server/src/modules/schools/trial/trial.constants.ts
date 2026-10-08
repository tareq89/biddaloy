export const TRIAL_QUEUE = 'trial-lifecycle';
export const TRIAL_JOB_ID = 'trial-lifecycle';
export const TRIAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

/** D32: used when the env var is unset. */
export const DEFAULT_TRIAL_DAYS = 30;
export const DEFAULT_TRIAL_SEAT_LIMIT = 10;

/** Warn this many days before the end; the key is remembered in `onboarding.trial_warnings`. */
export const TRIAL_WARNINGS = [
  { key: 'd7', days: 7, template: 'trial_warning_d7' },
  { key: 'd2', days: 2, template: 'trial_warning_d2' },
] as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
