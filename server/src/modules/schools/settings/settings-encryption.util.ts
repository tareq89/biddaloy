import { EncryptionService } from './encryption.service';
import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

/** Walks `segments` from `root`, stopping short (returning `undefined`) at
 * the first missing or non-object parent — a path the caller never
 * touched is exactly the "unaffected sections stay as they are" behaviour
 * `mergeTenantSettings` already relies on elsewhere in this module, not
 * an error. On success, returns the immediate parent object holding the
 * final segment, so the caller can both read and write through one walk
 * instead of two that could in principle disagree with each other. */
function resolveParent(
  root: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> | undefined {
  let cursor: Record<string, unknown> = root;
  for (const key of segments.slice(0, -1)) {
    const next = cursor[key];
    if (next === null || typeof next !== 'object') return undefined;
    cursor = next as Record<string, unknown>;
  }
  return cursor;
}

/** Applies `transform` to whichever of `paths` are present as non-empty
 * strings in `obj`, leaving everything else (including an explicit
 * `null`, which needs different handling than a plain "not present" —
 * see `settings-mask.util.ts`'s own, separate walker) untouched. Shared
 * by `encryptSecretFields`/`decryptSecretFields` below — the only
 * difference between encrypting on write and decrypting on read is which
 * direction `transform` runs. */
function transformAtPaths(
  obj: Record<string, unknown>,
  paths: string[],
  transform: (value: string) => string,
): Record<string, unknown> {
  const result = structuredClone(obj);

  for (const path of paths) {
    const segments = path.split('.');
    const parent = resolveParent(result, segments);
    const lastKey = segments[segments.length - 1];
    const value = parent?.[lastKey];

    if (parent && typeof value === 'string' && value.length > 0) {
      parent[lastKey] = transform(value);
    }
  }

  return result;
}

/** Every `@Secret()`-marked field present in `settings` gets encrypted in
 * place; everything else passes through unchanged. Generic over whatever
 * `getSecretPaths(TenantSettingsDto)` finds — see that function's own
 * comment for why this isn't a hardcoded field list. */
export function encryptSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
): Record<string, unknown> {
  return transformAtPaths(settings, getSecretPaths(TenantSettingsDto), (plaintext) =>
    encryption.encrypt(plaintext),
  );
}

/** Inverse of `encryptSecretFields` — for trusted internal callers that
 * genuinely need the plaintext (e.g. #8.7.10's per-tenant provider
 * resolver, decrypting in memory only to make an outbound send). Never
 * return this from an HTTP handler: #8.7.9's settings API calls
 * `maskSecretFields` (`settings-mask.util.ts`) instead, which decrypts
 * internally only to compute a redacted `hint` and never lets the full
 * plaintext leave this module. */
export function decryptSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
): Record<string, unknown> {
  return transformAtPaths(settings, getSecretPaths(TenantSettingsDto), (ciphertext) =>
    encryption.decrypt(ciphertext),
  );
}
