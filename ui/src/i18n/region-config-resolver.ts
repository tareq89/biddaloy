import type { RegionSettings } from '@biddaloy/shared';

import type { RegionConfig } from './region-config';

/**
 * #142's whole point, cashed in: `RegionConfig` was built with an
 * injectable source specifically so swapping build-time defaults for a
 * tenant's stored settings is a provider-value change, not a refactor —
 * see `region-config-provider.tsx`'s own comment. This is that swap's
 * other half: turning `RegionSettings` (the tenant-settings API shape,
 * `@biddaloy/shared`) into a `RegionConfig` (`ui`'s own shape, e.g. a
 * compiled `RegExp` for `phone.pattern` instead of a regex source string,
 * since `RegionConfig` isn't required to survive JSON the way
 * `RegionSettings` is).
 *
 * Merges **per field**, not all-or-nothing (#8.7.14's own acceptance
 * criterion) — a tenant who only overrode `currency` still gets the
 * locale default's `phone`/`address`/etc., and a tenant with no stored
 * region settings at all (`tenantRegion` undefined) gets exactly
 * `fallback`, unchanged: "a tenant with no regional settings behaves
 * exactly as it does today."
 *
 * In practice the server already resolves a tenant's settings against
 * `DEFAULT_REGION_SETTINGS` before this ever reaches the client (see
 * `resolveTenantSettings` server-side), so `tenantRegion` is usually
 * already complete — this still merges field-by-field rather than
 * trusting that, since a stale cached response or a future API change
 * that stops guaranteeing completeness shouldn't silently drop half a
 * region's formatting rules.
 */
export function resolveRegionConfig(
  fallback: RegionConfig,
  tenantRegion?: Partial<RegionSettings>,
): RegionConfig {
  if (!tenantRegion) return fallback;

  return {
    locale: tenantRegion.locale ?? fallback.locale,
    numerals: tenantRegion.numerals ?? fallback.numerals,
    timezone: tenantRegion.timezone ?? fallback.timezone,
    currency: {
      code: tenantRegion.currency?.code ?? fallback.currency.code,
      symbol: tenantRegion.currency?.symbol ?? fallback.currency.symbol,
      position: tenantRegion.currency?.position ?? fallback.currency.position,
      decimals: tenantRegion.currency?.decimals ?? fallback.currency.decimals,
      grouping: tenantRegion.currency?.grouping ?? fallback.currency.grouping,
    },
    date: {
      format: tenantRegion.date?.format ?? fallback.date.format,
      firstDayOfWeek: tenantRegion.date?.firstDayOfWeek ?? fallback.date.firstDayOfWeek,
      calendar: tenantRegion.date?.calendar ?? fallback.date.calendar,
    },
    phone: {
      country: tenantRegion.phone?.country ?? fallback.phone.country,
      pattern: compilePattern(tenantRegion.phone?.pattern, fallback.phone.pattern),
      example: tenantRegion.phone?.example ?? fallback.phone.example,
      displayFormat: tenantRegion.phone?.displayFormat ?? fallback.phone.displayFormat,
    },
    address: {
      fields: tenantRegion.address?.fields ?? fallback.address.fields,
      order: tenantRegion.address?.order ?? fallback.address.order,
    },
    academicYear: {
      startMonth: tenantRegion.academicYear?.startMonth ?? fallback.academicYear.startMonth,
    },
    identifiers: {
      national: tenantRegion.identifiers?.national ?? fallback.identifiers.national,
      student: tenantRegion.identifiers?.student ?? fallback.identifiers.student,
    },
  };
}

/** `RegionSettings.phone.pattern` travels as a regex *source* string (see
 * `RegionConfig`'s own comment on why); an invalid one — a typo saved
 * through some future settings UI that doesn't validate it — falls back
 * to `fallback`'s already-known-valid pattern instead of throwing and
 * taking the whole region resolution down with it. */
function compilePattern(source: string | undefined, fallback: RegExp): RegExp {
  if (!source) return fallback;
  try {
    return new RegExp(source);
  } catch {
    return fallback;
  }
}
