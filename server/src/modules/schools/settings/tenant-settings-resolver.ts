import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import { DEFAULT_REGION_SETTINGS } from './tenant-settings-defaults';
import type { TenantSettings } from '@beton-boi/shared';

/**
 * Resolves a school's raw `settings` jsonb column against defaults, one
 * top-level section at a time — a school that has configured
 * `communications.email` but never touched `region` still gets sane
 * regional defaults, and vice versa. `null`/empty settings resolve to
 * defaults entirely rather than throwing.
 */
export function resolveTenantSettings(stored: Record<string, unknown> | null): TenantSettings {
  const region = (stored?.region as TenantSettings['region']) ?? DEFAULT_REGION_SETTINGS;
  const communications = stored?.communications as TenantSettings['communications'];

  return {
    version: TENANT_SETTINGS_SCHEMA_VERSION,
    region,
    ...(communications ? { communications } : {}),
  };
}
