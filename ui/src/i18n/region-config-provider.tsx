import { createContext, useContext, type ReactNode } from 'react';

import type { Locale } from './locale-storage';
import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from './region-config';
import { useLocale } from './use-locale';

const LOCALE_REGION_DEFAULTS: Record<Locale, RegionConfig> = {
  bn: REGION_BD_BN,
  en: REGION_BD_EN,
};

const RegionConfigContext = createContext<RegionConfig>(REGION_BD_BN);

export interface RegionConfigProviderProps {
  children: ReactNode;
  /** Overrides the locale-derived default. This is the entire "provider
   * swap" #8.7.14 needs: once a tenant's own settings are resolved into a
   * `RegionConfig`, passing it here is the whole change — every
   * `useRegionConfig()` call site downstream picks it up with no changes
   * of its own. The app itself doesn't pass this today; only tests and
   * `#8.7.14`'s eventual tenant-settings wiring do. */
  value?: RegionConfig;
}

/** Defaults to the BD region matching the active locale — `bn` and `en`
 * share every regional rule except numeral system (see `REGION_BD_EN`'s
 * own comment), so this is genuinely "one country, two locales" rather
 * than two independent configs that happen to agree. Must be nested
 * inside `I18nProvider`, same requirement as `useLocale()` itself. */
export function RegionConfigProvider({ children, value }: RegionConfigProviderProps) {
  const { locale } = useLocale();
  const resolved = value ?? LOCALE_REGION_DEFAULTS[locale];

  return <RegionConfigContext.Provider value={resolved}>{children}</RegionConfigContext.Provider>;
}

export function useRegionConfig(): RegionConfig {
  return useContext(RegionConfigContext);
}
