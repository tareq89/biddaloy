/**
 * i18next setup, locale registry and per-tenant region configuration.
 *
 * `RegionConfig` (currency, numerals, date/phone/address formatting) is
 * [8.7.2]'s job — this barrel covers the i18next wiring itself: instance
 * config, namespace loading, and locale persistence/switching.
 */
export { i18n, createI18nInstance, whenReady, COMMON_NAMESPACE } from './i18n';
export { I18nProvider, type I18nProviderProps } from './locale-provider';
export { useLocale, type UseLocaleResult } from './use-locale';
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  getPersistedLocale,
  persistLocale,
  type Locale,
} from './locale-storage';
export { useTranslation } from 'react-i18next';
