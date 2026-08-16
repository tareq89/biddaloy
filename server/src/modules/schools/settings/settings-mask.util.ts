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
// Below this length, `slice(-HINT_VISIBLE_CHARS)` doesn't hide enough of
// the secret to still count as a hint — e.g. a 4-char value's "hint"
// would be the entire value behind decorative bullets.
const HINT_MIN_PLAINTEXT_CHARS = 8;

function maskValue(plaintext: string): MaskedSecret {
  if (plaintext.length < HINT_MIN_PLAINTEXT_CHARS) {
    return { configured: true };
  }
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
 *
 * A field that fails to decrypt (a stale key, or a legacy plaintext row
 * `yarn settings:reencrypt` hasn't reached yet — same failure mode
 * `decryptSecretFields` in `settings-encryption.util.ts` already guards
 * against) does not take down the whole response: it's reported as
 * `{ configured: true }` with no hint — the field genuinely is
 * configured, this function just can't truthfully hint at it — rather
 * than throwing and 500-ing every other, unrelated section (`region`
 * included) of a school's settings. `onError`, if given, is called with
 * the failing path so a caller can log which school/field needs
 * attention, mirroring `decryptSecretFields`'s own `onError`.
 */
export function maskSecretFields(
  settings: Record<string, unknown>,
  encryption: EncryptionService,
  onError?: (error: unknown, path: string) => void,
): Record<string, unknown> {
  const result = structuredClone(settings);

  for (const path of getSecretPaths(TenantSettingsDto)) {
    const segments = path.split('.');
    const parent = resolveParent(result, segments);
    if (!parent) continue;

    const lastKey = segments[segments.length - 1];
    const value = parent[lastKey];

    if (typeof value === 'string' && value.length > 0) {
      try {
        parent[lastKey] = maskValue(encryption.decrypt(value));
      } catch (error) {
        parent[lastKey] = { configured: true };
        onError?.(error, path);
      }
    } else if (value === null) {
      parent[lastKey] = { configured: false };
    }
  }

  return result;
}
