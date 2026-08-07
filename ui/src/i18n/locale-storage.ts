export const SUPPORTED_LOCALES = ['bn', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Bangla first — the epic's own framing: this is a Bangladeshi platform
 * that also speaks English, not the other way around. */
export const DEFAULT_LOCALE: Locale = 'bn';

/** Neither supported locale is RTL today — both map to `'ltr'` — but this
 * is the one place that decides, so adding an RTL locale later is a
 * one-line addition here, not a hunt through every component that reads
 * `document.dir`. See `locale-provider.tsx`'s `<html lang>`/`dir` sync and
 * `ui/CONTRIBUTING.md`'s note on why every component already uses logical
 * (`margin-inline-*`/`padding-inline-*`) CSS for exactly this day. */
export const LOCALE_DIR: Record<Locale, 'ltr' | 'rtl'> = {
  bn: 'ltr',
  en: 'ltr',
};

const STORAGE_KEY = 'beton-boi:locale';

function isSupportedLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Reads the persisted locale choice. Falls back to `DEFAULT_LOCALE` for a
 * first visit, a cleared/corrupted value, or an environment with no
 * `localStorage` (SSR, a locked-down webview) — `localStorage` access
 * itself can throw (Safari private mode, some embedded browsers), so this
 * never lets that surface as an unhandled error over something as
 * low-stakes as which language to start in. */
export function getPersistedLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Same reasoning as getPersistedLocale: losing persistence is fine,
    // throwing over it mid-render is not.
  }
}
