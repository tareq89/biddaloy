import { instanceToPlain } from 'class-transformer';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

/** `instanceToPlain(dto, { exposeUnsetFields: false })` — a class instance
 * whose properties the caller never set stay absent from the result
 * rather than appearing as explicit `undefined`s. `mergeTenantSettings`
 * (and encryption, which needs to run against the same plain shape
 * *before* merging — see `SchoolsService.updateSettings`) both depend on
 * that: spreading an object with explicit `undefined` values over
 * `currentCommunications` would blank out every medium the patch didn't
 * touch instead of leaving them alone. An explicit `null` (how a caller
 * clears a secret — #8.7.9) is a real, present key and survives this the
 * same way any other value does; only genuinely *unset* properties are
 * dropped. */
export function toPlainSettingsPatch(dto: TenantSettingsDto): Record<string, unknown> {
  return instanceToPlain(dto, { exposeUnsetFields: false });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merges `patch` into `existing` key by key, recursively, so a key the
 * patch never sent is left exactly as it was stored — the general form
 * of "omitting a secret leaves it unchanged" (#8.7.9's PATCH contract):
 * that's true for every field at every depth here, not something special
 * about secret fields specifically. `null` and every non-object value
 * (a fresh plaintext secret about to be encrypted, an already-encrypted
 * string carried over untouched, a number, ...) replace the existing
 * value outright rather than merging into it — there's nothing to merge
 * a scalar with.
 */
function deepMergeOmittingUnset(existing: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;

  const base = isPlainObject(existing) ? existing : {};
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMergeOmittingUnset(base[key], value);
  }
  return merged;
}

/**
 * Merges an already-plain settings patch (see `toPlainSettingsPatch`) into
 * the existing stored jsonb blob.
 *
 * `region` is one dashboard section and is replaced wholesale when
 * present — the form that produces it always submits every field, so
 * there's no "omit to leave unchanged" case to support there.
 *
 * `communications` merges recursively (`deepMergeOmittingUnset`): saving
 * the WhatsApp section doesn't clobber an already-configured SMS section
 * sitting next to it (#8.7.13 saves per-section, not one page-wide
 * submit), *and*, one level further in, omitting a medium's secret field
 * from the patch leaves that medium's other fields (and the secret
 * itself) untouched — the write half of #8.7.9's "omitting a secret key
 * in a PATCH leaves it unchanged; sending `null` clears it."
 *
 * Takes a plain object rather than the `TenantSettingsDto` instance
 * itself so `SchoolsService.updateSettings` can run encryption
 * (`encryptSecretFields`, #8.7.8) against the patch's own plain
 * representation *before* merging — encrypting the full merged object
 * instead would re-encrypt already-encrypted fields carried over
 * unchanged from `existing`.
 */
export function mergeTenantSettings(
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const current = existing ?? {};

  const merged: Record<string, unknown> = {
    ...current,
    version: patch.version,
  };

  if (patch.region !== undefined) {
    merged.region = patch.region;
  }

  if (patch.communications !== undefined) {
    merged.communications = deepMergeOmittingUnset(current.communications, patch.communications);
  }

  return merged;
}
