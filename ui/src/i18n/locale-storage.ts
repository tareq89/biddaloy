export const SUPPORTED_LOCALES = ['bn', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Bangla first — the epic's own framing: this is a Bangladeshi platform
 * that also speaks English, not the other way around. */
export const DEFAULT_LOCALE: Locale = 'bn';

const STORAGE_KEY = 'beton-boi:locale';

function isSupportedLocale(value: string | null | undefined): value is Locale {
  return value != null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Narrows any language tag i18next hands back to one this app actually
 * supports. i18next will happily report a language it was *asked* for even
 * when `supportedLngs` excludes it — `changeLanguage('fr')` leaves
 * `i18n.language` as `'fr'` while only `resolvedLanguage` falls back — so
 * anything reading a locale off the instance has to narrow it rather than
 * assert it, or `Locale` starts lying about what a caller can receive. */
export function toSupportedLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
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

/** Forgets the persisted choice, so the next read falls back to
 * `DEFAULT_LOCALE` as if this were a first visit. Exists for
 * `cleanupTestState()` — the storage key is private to this module, and a
 * test helper reaching for the literal string would drift the moment it
 * changed here. */
export function clearPersistedLocale(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above — an environment without usable storage has nothing to clear.
  }
}
