import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import { DEFAULT_ATTENDANCE_SETTINGS, DEFAULT_REGION_SETTINGS } from './tenant-settings-defaults';
import type { TenantSettings } from '@biddaloy/shared';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Overlays whatever a school actually stored on top of `defaults`,
 * field by field, all the way down.
 *
 * The stored blob is not re-validated on read — it was validated when it
 * was written, but it can predate a schema change, be hand-edited, or be
 * restored from a backup, so a section that's present is not necessarily
 * complete. Walking `defaults` (rather than the stored value) means the
 * result always has every field the type promises, and any key the
 * current schema doesn't know about is dropped instead of being handed
 * to a caller that has no idea what to do with it.
 *
 * A stored value that's the wrong *kind* — an object where a scalar
 * belongs, `null` where a nested group belongs — falls back to the
 * default for that field alone rather than discarding the whole section:
 * one bad field shouldn't cost a school every other setting next to it.
 * Arrays (`address.fields`/`order`) are replaced wholesale, never merged
 * element-wise, since a school's field list is a complete statement, not
 * an addition to ours.
 */
function overlayOnDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(stored) || !isPlainObject(defaults)) return defaults;

  const result: Record<string, unknown> = { ...defaults };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const storedValue = stored[key];
    if (storedValue === undefined || storedValue === null) continue;

    if (isPlainObject(defaultValue)) {
      result[key] = overlayOnDefaults(defaultValue, storedValue);
    } else if (Array.isArray(defaultValue)) {
      result[key] = Array.isArray(storedValue) ? storedValue : defaultValue;
    } else {
      result[key] = typeof storedValue === typeof defaultValue ? storedValue : defaultValue;
    }
  }

  return result as T;
}

/**
 * Resolves a school's raw `settings` jsonb column against defaults, one
 * top-level section at a time — a school that has configured
 * `communications.email` but never touched `region` still gets sane
 * regional defaults, and vice versa. `null`/empty settings resolve to
 * defaults entirely rather than throwing.
 *
 * `region` resolves per *field*, not per section: a stored
 * `{ region: { locale: 'en-BD' } }` comes back as the full default region
 * with only `locale` overridden, so callers can rely on every region
 * field being present regardless of how partially the row was written.
 * `communications` has no defaults to merge against — a medium is either
 * configured or it isn't — so it passes through as stored, minus a
 * non-object value, which would only mislead a caller that trusts the
 * type.
 */
export function resolveTenantSettings(stored: Record<string, unknown> | null): TenantSettings {
  const region = overlayOnDefaults(DEFAULT_REGION_SETTINGS, stored?.region);
  const attendance = overlayOnDefaults(DEFAULT_ATTENDANCE_SETTINGS, stored?.attendance);
  const communications = isPlainObject(stored?.communications)
    ? (stored.communications as TenantSettings['communications'])
    : undefined;

  return {
    version: TENANT_SETTINGS_SCHEMA_VERSION,
    region,
    attendance,
    ...(communications ? { communications } : {}),
  };
}
