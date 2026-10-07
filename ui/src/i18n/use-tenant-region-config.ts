import { Permission, type RegionSettings } from '@biddaloy/shared';
import { useQuery } from '@tanstack/react-query';

import { getActiveTenant } from '../api/auth-state';
import { useHasPermission } from '../hooks/permissions';
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
 *
 * Roles without `SETTINGS_MANAGE` cannot read the settings endpoint, so the
 * query is not even sent for them: they get the locale default, with no 403
 * and no toast.
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
  // ponytail: roles without SETTINGS_MANAGE never see the school's own region
  // settings; upgrade is a read-only GET any member may call (follow-up).
  const canReadSettings = useHasPermission(Permission.SETTINGS_MANAGE);
  const { data } = useQuery({
    ...schoolSettingsQueryOptions(tenantId ?? ''),
    enabled: tenantId !== null && canReadSettings,
    throwOnError: false,
  });

  // [17.1.3] `data.region` is the OpenAPI-generated DTO shape, whose
  // `calendar.termLabel` is a plain string-literal union
  // ("TERM" | "SEMESTER" | "TRIMESTER") rather than the shared
  // `TermLabel` enum `resolveRegionConfig` expects — the two are
  // value-identical (`shared/src/enums/calendar-enums.spec.ts` pins the
  // enum to that exact member set), so this cast is safe.
  // A disabled query still returns cached data, so a role that just lost
  // SETTINGS_MANAGE must not keep the region an earlier role loaded.
  const region = canReadSettings ? data?.region : undefined;
  return resolveRegionConfig(fallback, region as Partial<RegionSettings> | undefined);
}
