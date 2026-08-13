/**
 * i18next setup, locale registry and per-tenant region configuration.
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
export {
  REGION_BD_BN,
  REGION_BD_EN,
  LOCALE_REGION_DEFAULTS,
  bnDigits,
  type RegionConfig,
  type NumeralSystem,
  type CurrencyGrouping,
} from './region-config';
export {
  RegionConfigProvider,
  useRegionConfig,
  type RegionConfigProviderProps,
} from './region-config-provider';
export { resolveRegionConfig } from './region-config-resolver';
export { useTenantRegionConfig } from './use-tenant-region-config';
