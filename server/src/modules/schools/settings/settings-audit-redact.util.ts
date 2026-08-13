import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

const REDACTED = '[REDACTED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Picks the sub-tree of `existing` shaped like `patch` — only the
 * keys/paths the patch actually touches, at every depth. A PATCH only ever
 * names the sections it's changing (`toPlainSettingsPatch`'s "omit to
 * leave unchanged" contract, see `tenant-settings-merge.util.ts`), so
 * diffing against the *whole* stored settings object would make every
 * untouched field look changed in the audit trail. This is the nested
 * equivalent of `FeeStructureService.update`'s `changedKeys` picking.
 */
export function pickPatchShape(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, patchValue] of Object.entries(patch)) {
    const existingValue = existing[key];
    result[key] =
      isPlainObject(patchValue) && isPlainObject(existingValue)
        ? pickPatchShape(existingValue, patchValue)
        : existingValue;
  }
  return result;
}

/**
 * Replaces every `@Secret()`-marked field present in `settings` with a
 * fixed `[REDACTED]` marker — the shape `AuditLog.old_values`/`new_values`
 * actually get written as (#8.7.11). Driven from
 * `getSecretPaths(TenantSettingsDto)` rather than `audit/redact.util.ts`'s
 * generic key-name matching: a field is masked because the schema marks it
 * `@Secret()`, not because its name happens to contain a word like
 * "token" — the same reasoning `secret-field.decorator.ts` gives for why
 * encryption and audit redaction both walk the DTO tree instead of each
 * keeping their own list.
 */
export function redactSecretPaths(settings: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(settings);

  for (const path of getSecretPaths(TenantSettingsDto)) {
    const segments = path.split('.');
    let cursor: Record<string, unknown> | undefined = result;
    for (const key of segments.slice(0, -1)) {
      const next: unknown = cursor?.[key];
      cursor = isPlainObject(next) ? next : undefined;
      if (!cursor) break;
    }

    const lastKey = segments[segments.length - 1];
    if (cursor && cursor[lastKey] !== undefined) {
      cursor[lastKey] = REDACTED;
    }
  }

  return result;
}
