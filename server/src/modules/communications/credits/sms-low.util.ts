/** [100 D20] "Almost finished" thresholds. Fixed in code, not settings: the owner cannot change them. */
export const SMS_LOW_FLOOR = 100;
export const SMS_LOW_FRACTION = 0.1;

export interface SmsLowInput {
  remaining: number;
  /** Unexpired lots only. */
  activeLots: { units_total: number }[];
}

/** True when `remaining` is at or under 100, or under 10% of the active lots' total, whichever
 * threshold is larger. `stopped` is the separate "nothing left" state (remaining is 0). */
export function isAlmostFinished({ remaining, activeLots }: SmsLowInput): {
  almostFinished: boolean;
  stopped: boolean;
} {
  const total = activeLots.reduce((sum, lot) => sum + lot.units_total, 0);
  return {
    almostFinished: remaining <= SMS_LOW_FLOOR || remaining < SMS_LOW_FRACTION * total,
    stopped: remaining === 0,
  };
}
