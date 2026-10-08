import { toIsoDate } from '@biddaloy/ui/utils';

/** `YYYY-MM-DD` plus `n` days, on the local calendar. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

/** D29: a day is markable if it is today or at most 7 days back; else today. */
export function clampMarkingDate(date: string | undefined, today: string): string {
  if (!date || date > today || date < addDays(today, -7)) return today;
  return date;
}
