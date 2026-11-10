/**
 * Formats a bare calendar day (`YYYY-MM-DD`, already the school's own date: the server builds
 * event and admission days in the school timezone). A bare day has no timezone, so it is read
 * and printed as UTC: the same day shows in any school's timezone and any visitor's browser.
 * Returns `undefined` for anything that is not a real day.
 */
export function formatDay(
  day: string | undefined,
  loc: string,
  opts: Intl.DateTimeFormatOptions,
): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? undefined
    : d.toLocaleDateString(loc, { ...opts, timeZone: 'UTC' });
}
