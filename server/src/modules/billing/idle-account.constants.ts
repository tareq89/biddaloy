import { DAY_MS } from '../schools/trial/trial.constants';

export const IDLE_WARN_DAY = 20;
export const IDLE_URGENT_DAY = 27;
export const IDLE_SUSPEND_DAY = 30;
/** After the suspension (about day 60). */
export const IDLE_DELETE_AFTER_DAYS = 30;
/** `idle_d27` must be this old before the school is suspended. */
export const IDLE_SUSPEND_GAP_DAYS = 3;
/** After `deleted_at`. */
export const IDLE_REVIVE_WINDOW_DAYS = 90;

/** Start of the idle clock: the later of signup and the last time the school became ACTIVE. */
export function idleClock(createdAt: Date, statusChangedAt: Date | null): Date {
  return statusChangedAt && statusChangedAt > createdAt ? statusChangedAt : createdAt;
}

/** Whole days since the clock (floor). */
export function idleAgeDays(clock: Date, now: Date): number {
  return Math.floor((now.getTime() - clock.getTime()) / DAY_MS);
}
