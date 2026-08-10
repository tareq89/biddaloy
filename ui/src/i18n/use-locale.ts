import { useTranslation } from 'react-i18next';

import { toSupportedLocale, type Locale } from './locale-storage';

export interface UseLocaleResult {
  locale: Locale;
  /** Switches the active locale. Persistence to `localStorage` happens as
   * a side effect of the change itself (`i18n.ts` wires a
   * `languageChanged` listener once, at instance creation), not here — so
   * a locale change triggered any other way (devtools, a future
   * server-driven default) is persisted too, not just ones that went
   * through this hook. */
  setLocale: (locale: Locale) => void;
}

/** Must be called from inside `<I18nProvider>` — same requirement as
 * `useTranslation()` itself, which this wraps. Re-renders whenever the
 * active locale changes, including a change triggered from outside this
 * hook's own `setLocale` (react-i18next's `useTranslation` already
 * subscribes to `languageChanged`).
 *
 * Reads `resolvedLanguage` rather than `language`, and narrows the result:
 * `language` is whatever was last *requested*, which i18next keeps even
 * when `supportedLngs` rejects it, so a stray `changeLanguage('fr')` (a
 * devtools poke, a future server-driven default) would otherwise hand
 * every consumer a `Locale` of `'fr'` that no `LOCALE_REGION_DEFAULTS`- or
 * `LOCALE_DIR`-style lookup has an entry for. `resolvedLanguage` already
 * applies `fallbackLng`; `toSupportedLocale` covers the remaining window
 * before init settles, when both are still `undefined`. */
export function useLocale(): UseLocaleResult {
  const { i18n } = useTranslation();

  return {
    locale: toSupportedLocale(i18n.resolvedLanguage ?? i18n.language),
    setLocale: (locale) => {
      void i18n.changeLanguage(locale);
    },
  };
}
