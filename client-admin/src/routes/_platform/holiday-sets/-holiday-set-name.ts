import type { PublicHolidaySet } from '@biddaloy/ui/hooks';
import type { TFunction } from 'i18next';

/** "Bangladesh" / "বাংলাদেশ" for `BD`, in the UI language. Stdlib, covers every
 * ISO code in both languages; an unknown code falls back to itself. */
export function countryName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Bangladesh 2026" — the list's name column, the detail `h1` and the
 * crumb all read the same. `year` stays a number so the i18next numeral
 * formatter renders it in tenant digits. */
export function holidaySetName(
  set: Pick<PublicHolidaySet, 'country' | 'year'>,
  language: string,
  t: TFunction<'platform'>,
): string {
  return t('holidaySets.setName', { country: countryName(set.country, language), year: set.year });
}

export const SOURCE_LABEL_KEY: Record<PublicHolidaySet['source'], string> = {
  NAGER_DATE: 'holidaySets.source.NAGER_DATE',
  GOOGLE_ICS: 'holidaySets.source.GOOGLE_ICS',
  MANUAL: 'holidaySets.source.MANUAL',
};
