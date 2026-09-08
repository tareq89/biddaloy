import { useQuery } from '@tanstack/react-query';

import { getActiveTenant } from '../api/auth-state';
import { schoolSettingsQueryOptions } from '../hooks/school-settings';

import { LOCALE_REGION_DEFAULTS, type RegionConfig } from './region-config';
import { resolveRegionConfig } from './region-config-resolver';
import { useLocale } from './use-locale';

/**
 * #8.7.14's provider-swap value, computed: the active tenant's stored
 * `region` settings resolved into a `RegionConfig` — pass the result
 * straight to `<RegionConfigProvider value={...}>`, nothing downstream
 * needs to change (`RegionConfigProvider`'s own comment on why).
 *
 * Reads `getActiveTenant()` fresh on every call rather than subscribing
 * to it — `auth-state.ts` has no reactive store yet (see its own
 * comment), so this hook alone re-rendering on a tenant switch depends
 * on *something* causing the component that calls it to re-render.
 * `switchActiveTenant` (`hooks/tenant.ts`) already covers that:
 * `setActiveTenant` runs, then `queryClient.clear()` resets every
 * mounted query (including whichever `useSchoolSettings` call is
 * feeding this hook) back to a loading state — the resulting re-render
 * is what picks the new tenant id up here, in step with the cache clear
 * #8.7.14's acceptance criteria calls out. No new reactive plumbing
 * needed; this rides the one that already exists.
 *
 * Falls back to the locale-derived BD default while the tenant's
 * settings are still loading (or failed to load) — a slow/failed
 * request must not leave every regional formatter without a config to
 * read, and once #158's masked-settings GET resolves, this re-renders
 * with the resolved value. `useSchoolSettings`'s own masked-secrets
 * shape is irrelevant here; `region` never carries a secret field.
 */
export function useTenantRegionConfig(): RegionConfig {
  const { locale } = useLocale();
  const tenantId = getActiveTenant();
  const fallback = LOCALE_REGION_DEFAULTS[locale];

  // `throwOnError: false` — this hook's whole contract is "fall back to
  // the locale default when settings can't load" (see above), so a
  // suspended tenant's 403 must resolve to that fallback too rather than
  // rethrow into the route boundary the way a page-level query does
  // [15.4.2]; the provider wrapping a screen is chrome, not content.
  const { data } = useQuery({ ...schoolSettingsQueryOptions(tenantId ?? ''), throwOnError: false });

  return resolveRegionConfig(fallback, data?.region);
}
