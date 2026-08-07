export const SUPPORTED_LOCALES = ['bn', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Bangla first — the epic's own framing: this is a Bangladeshi platform
 * that also speaks English, not the other way around. */
export const DEFAULT_LOCALE: Locale = 'bn';

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
