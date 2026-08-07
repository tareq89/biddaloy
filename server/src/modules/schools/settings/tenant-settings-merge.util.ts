import { instanceToPlain } from 'class-transformer';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

/** `instanceToPlain(dto, { exposeUnsetFields: false })` — a class instance
 * whose properties the caller never set stay absent from the result
 * rather than appearing as explicit `undefined`s. `mergeTenantSettings`
 * (and encryption, which needs to run against the same plain shape
 * *before* merging — see `SchoolsService.updateSettings`) both depend on
 * that: spreading an object with explicit `undefined` values over
 * `currentCommunications` would blank out every medium the patch didn't
 * touch instead of leaving them alone. */
export function toPlainSettingsPatch(dto: TenantSettingsDto): Record<string, unknown> {
  return instanceToPlain(dto, { exposeUnsetFields: false });
}

/**
 * Merges an already-plain settings patch (see `toPlainSettingsPatch`) into
 * the existing stored jsonb blob. `region` is one dashboard section and is
 * replaced wholesale when present; `communications` is merged one level
 * deeper so saving the WhatsApp section, say, does not clobber an
 * already-configured SMS section sitting next to it (#8.7.13 saves
 * per-section, not one page-wide submit).
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
  const currentCommunications = (current.communications as Record<string, unknown>) ?? {};

  const merged: Record<string, unknown> = {
    ...current,
    version: patch.version,
  };

  if (patch.region !== undefined) {
    merged.region = patch.region;
  }

  if (patch.communications !== undefined) {
    merged.communications = {
      ...currentCommunications,
      ...(patch.communications as Record<string, unknown>),
    };
  }

  return merged;
}
