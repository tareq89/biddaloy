import { instanceToPlain } from 'class-transformer';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

/**
 * Merges a validated settings patch into the existing stored jsonb blob.
 * `region` is one dashboard section and is replaced wholesale when
 * present; `communications` is merged one level deeper so saving the
 * WhatsApp section, say, does not clobber an already-configured SMS
 * section sitting next to it (#8.7.13 saves per-section, not one
 * page-wide submit).
 */
export function mergeTenantSettings(
  existing: Record<string, unknown> | null,
  patch: TenantSettingsDto,
): Record<string, unknown> {
  const current = existing ?? {};
  const currentCommunications = (current.communications as Record<string, unknown>) ?? {};

  const merged: Record<string, unknown> = {
    ...current,
    version: patch.version,
  };

  if (patch.region !== undefined) {
    merged.region = instanceToPlain(patch.region, { exposeUnsetFields: false });
  }

  if (patch.communications !== undefined) {
    merged.communications = {
      ...currentCommunications,
      // `exposeUnsetFields: false` — otherwise class-transformer emits an
      // explicit `undefined` for every medium the patch didn't touch
      // (sms, email, messenger), and spreading those over
      // `currentCommunications` would blank them out instead of leaving
      // them alone.
      ...instanceToPlain(patch.communications, { exposeUnsetFields: false }),
    };
  }

  return merged;
}
