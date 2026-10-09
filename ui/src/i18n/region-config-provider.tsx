import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';

import { setInterpolationNumerals } from './i18n';
import {
  LOCALE_REGION_DEFAULTS,
  REGION_BD_BN,
  type NumeralSystem,
  type RegionConfig,
} from './region-config';
import { useLocale } from './use-locale';

const RegionConfigContext = createContext<RegionConfig>(REGION_BD_BN);
const DepthContext = createContext(0);

// ponytail: one global numeral system for i18next's formatter. Every mounted provider registers
// here; the deepest one (ties: the latest) wins, so unmounting one provider restores another's
// value instead of wiping it. Upgrade path: numerals in i18next's per-call options if two
// tenants ever render at once.
const mounted: { depth: number; numerals: NumeralSystem }[] = [];
function syncNumerals(): void {
  let top: (typeof mounted)[number] | undefined;
  for (const entry of mounted) if (!top || entry.depth >= top.depth) top = entry;
  setInterpolationNumerals(top?.numerals);
}

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
  const depth = useContext(DepthContext) + 1;

  // Set during render too: children call t() in this same pass, before any effect runs.
  setInterpolationNumerals(resolved.numerals);
  useLayoutEffect(() => {
    const entry = { depth, numerals: resolved.numerals };
    mounted.push(entry);
    syncNumerals();
    return () => {
      mounted.splice(mounted.indexOf(entry), 1);
      syncNumerals();
    };
  }, [depth, resolved.numerals]);

  return (
    <DepthContext.Provider value={depth}>
      <RegionConfigContext.Provider value={resolved}>{children}</RegionConfigContext.Provider>
    </DepthContext.Provider>
  );
}

export function useRegionConfig(): RegionConfig {
  return useContext(RegionConfigContext);
}
