export const MAX_SEATS = 100_000;
export const MAX_MONTHS = 24;
export const MIN_BUY_SEATS = 100;

/** Integer paisa, never a float. `unit` is the school's own price; the server re-computes the real total. */
export function orderTotalPaisa(seats: number, months: number, unit: number): number {
  return seats * months * unit;
}

/** Prefill: cover the students who have no seat, at least 100. */
export function defaultSeats(used: number, bought: number): number {
  return Math.max(used - bought, MIN_BUY_SEATS);
}

/** A whole number in `1..max`, or `null`. Empty and fractional text are invalid. */
export function parseWhole(text: string, max: number): number | null {
  // Bangla digits (০-৯) typed in the bn locale count as the same number.
  const ascii = text.trim().replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  if (!/^\d+$/.test(ascii)) return null;
  const n = Number(ascii);
  return n >= 1 && n <= max ? n : null;
}

/** Whole days from `now` to the ISO date `iso` (`YYYY-MM-DD`), negative once past. */
export function daysUntil(iso: string, now: Date): number {
  const end = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - today) / 86_400_000);
}
