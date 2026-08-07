import { getActiveTenant } from '../api/auth-state';
import { useSchoolSettings } from '../hooks/school-settings';

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

  const { data } = useSchoolSettings(tenantId ?? '');

  return resolveRegionConfig(fallback, data?.region);
}
