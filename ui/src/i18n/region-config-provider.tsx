import { createContext, useContext, type ReactNode } from 'react';

import { LOCALE_REGION_DEFAULTS, REGION_BD_BN, type RegionConfig } from './region-config';
import { useLocale } from './use-locale';

const RegionConfigContext = createContext<RegionConfig>(REGION_BD_BN);

export interface RegionConfigProviderProps {
  children: ReactNode;
  /** Overrides the locale-derived default. This is the entire "provider
   * swap" #8.7.14 needed: `useTenantRegionConfig()` resolves the active
   * tenant's stored settings into a `RegionConfig` and `App.tsx` passes it
   * here — every `useRegionConfig()` call site downstream picks it up
   * with no changes of its own. Tests still pass a fixed value directly,
   * bypassing the tenant-settings fetch entirely. */
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
