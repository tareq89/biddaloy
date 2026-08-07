const AES_256_KEY_BYTES = 32;

function decodeKey(label: string, base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error(
      `${label} must be base64 for exactly ${AES_256_KEY_BYTES} bytes (AES-256) — decoded to ${key.length} bytes. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Required in production, refusing to boot otherwise — the same "loud
 * failure beats a silent gap" posture as `DB_SSL` (`db-ssl.ts`) and
 * `ENABLE_API_DOCS` (`main.ts`). Outside production this stays opt-in:
 * a key set for local testing is still validated for shape, but its
 * absence doesn't block `yarn start:dev` or the unit-test suite — nothing
 * in those paths needs to actually encrypt a tenant secret to run.
 *
 * A malformed key (present but wrong length/encoding) fails loudly in
 * every environment, production or not — an unusable key is never
 * silently treated the same as no key.
 */
export function buildEncryptionKey(
  nodeEnv: string | undefined,
  keyEnv: string | undefined,
): Buffer | null {
  if (!keyEnv) {
    if (nodeEnv === 'production') {
      throw new Error(
        'SETTINGS_ENCRYPTION_KEY must be set in production — refusing to boot with tenant ' +
          'settings secrets (WhatsApp/email/SMS credentials) unencryptable.',
      );
    }
    return null;
  }

  return decodeKey('SETTINGS_ENCRYPTION_KEY', keyEnv);
}

/** Prior keys still accepted for decrypting rows a rotation hasn't
 * re-encrypted yet — see `EncryptionService`'s class comment for the full
 * rotation procedure. Comma-separated; empty entries (a trailing comma, a
 * blank env var) are ignored rather than treated as a malformed key. */
export function buildPreviousEncryptionKeys(previousKeysEnv: string | undefined): Buffer[] {
  if (!previousKeysEnv) return [];

  return previousKeysEnv
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => decodeKey('SETTINGS_ENCRYPTION_KEY_PREVIOUS', key));
}
