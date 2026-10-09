/** English month names — the writer (`period_label`) and the reader
 * (`periodStartFromLabel`) share this one list. */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `"April 2026"` -> `"2026-04"`. Anything that is not `<Month> <yyyy>`
 * (old free-form labels, empty strings) -> `undefined`. */
export function periodStartFromLabel(label: string): string | undefined {
  const match = /^([A-Za-z]+) (\d{4})$/.exec(label);
  if (!match) return undefined;
  const index = MONTH_NAMES.indexOf(match[1]!);
  if (index < 0) return undefined;
  return `${match[2]}-${String(index + 1).padStart(2, '0')}`;
}
