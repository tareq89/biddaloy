import { EncryptionService } from './encryption.service';
import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

export interface MaskedSecret {
  configured: boolean;
  /** Last 4 characters of the real value, prefixed with a fixed run of
   * bullets — `"••••4821"`. Present only when `configured` is `true`;
   * there's nothing to hint at otherwise. */
  hint?: string;
}

const HINT_VISIBLE_CHARS = 4;
const HINT_BULLET = '•';

function maskValue(plaintext: string): MaskedSecret {
  const visible = plaintext.slice(-HINT_VISIBLE_CHARS);
  return { configured: true, hint: `${HINT_BULLET.repeat(HINT_VISIBLE_CHARS)}${visible}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Same walk shape as `settings-encryption.util.ts`'s `resolveParent`, but
 * not reused from there: masking's three-way branch below (string / null /
 * absent) doesn't fit that module's "present non-empty string or skip"
 * transform signature, so this stays a small, separate walker rather than
 * forcing one shared function to serve two different contracts. */
function resolveParent(
  root: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> | undefined {
  let cursor: Record<string, unknown> = root;
  for (const key of segments.slice(0, -1)) {
    const next = cursor[key];
    if (!isPlainObject(next)) return undefined;
    cursor = next;
  }
  return cursor;
}

/**
 * Every `@Secret()`-marked field present in `settings` (still in its
 * stored, encrypted form) becomes a `MaskedSecret`:
 *
 * - a real (encrypted) value → `{ configured: true, hint: "••••4821" }`,
 *   the hint computed by decrypting internally — the only way to produce
 *   a truthful one — but the plaintext never leaves this function;
 * - an explicit `null` (the field was set, then cleared) → `{ configured:
 *   false }`, same as never having been set — a cleared secret and an
 *   always-empty one look identical to a caller, which is the point;
 * - the key absent entirely (the medium itself was never configured) →
 *   left absent. Nothing to mask, and synthesizing a placeholder object
 *   here would make "this school never configured WhatsApp at all" look
 *   the same as "WhatsApp is configured but has no access token," which
 *   isn't true.
 *
 * `SchoolsService.getDecryptedSettings` (full plaintext) exists for
 * callers that need more than a hint; this is the one and only path from
 * stored settings to an HTTP response, per #8.7.9's "secrets are
 * write-only" contract.
 */
export function maskSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
): Record<string, unknown> {
  const result = structuredClone(settings);

  for (const path of getSecretPaths(TenantSettingsDto)) {
    const segments = path.split('.');
    const parent = resolveParent(result, segments);
    if (!parent) continue;

    const lastKey = segments[segments.length - 1];
    const value = parent[lastKey];

    if (typeof value === 'string' && value.length > 0) {
      parent[lastKey] = maskValue(encryption.decrypt(value));
    } else if (value === null) {
      parent[lastKey] = { configured: false };
    }
  }

  return result;
}
