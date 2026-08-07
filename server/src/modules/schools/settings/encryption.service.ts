import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// 96-bit IV — the length GCM is designed and most efficient for; a longer
// IV is hashed down internally, which is both slower and not the
// well-analyzed case.
const IV_BYTES = 12;
// Marks the *envelope format* (delimiter layout, field order) — separate
// from which key encrypted it. A future algorithm change bumps this and
// `decrypt` can branch on it; it says nothing about key rotation, which
// `EncryptionService` handles by trying `currentKey` then `previousKeys`
// rather than by encoding a key identifier into the envelope.
const ENVELOPE_VERSION = 'gcmv1';

/**
 * AES-256-GCM for tenant-settings secrets (WhatsApp/email/SMS credentials
 * living in `schools.settings` jsonb — see `../dto/tenant-settings.dto.ts`'s
 * `@Secret()`-marked fields). `encrypt`/`decrypt` operate on single string
 * values; `settings-encryption.util.ts` is what walks a settings object
 * and applies these to the fields `getSecretPaths` finds.
 *
 * The stored form is a single delimited string — `gcmv1:<iv>:<tag>:<ct>`,
 * each part base64 — chosen over a `{v,iv,tag,ct}` object so a `@Secret()`
 * field's TypeScript type stays `string` before and after encryption; no
 * DTO or resolver code needs to know the value's shape changed.
 *
 * ## Key rotation
 *
 * 1. Generate a new key. Set `SETTINGS_ENCRYPTION_KEY_PREVIOUS` to the
 *    *current* value of `SETTINGS_ENCRYPTION_KEY`, then set
 *    `SETTINGS_ENCRYPTION_KEY` to the new one. Deploy.
 * 2. From this point, every new write encrypts under the new key.
 *    Existing rows still decrypt fine — `decrypt` tries `currentKey`
 *    first, then each of `previousKeys`, and GCM's auth tag makes "wrong
 *    key" fail cleanly rather than returning garbage, so trying multiple
 *    keys in sequence is safe.
 * 3. Re-encrypt old rows under the new key on whatever cadence is
 *    convenient — every value gets touched again on its next legitimate
 *    write (#8.7.9's settings API) even with no dedicated migration, since
 *    a write re-encrypts under `currentKey` unconditionally.
 * 4. Once satisfied nothing still depends on the old key, drop
 *    `SETTINGS_ENCRYPTION_KEY_PREVIOUS` and deploy again.
 */
@Injectable()
export class EncryptionService {
  constructor(
    private readonly currentKey: Buffer | null,
    private readonly previousKeys: Buffer[] = [],
  ) {}

  encrypt(plaintext: string): string {
    if (!this.currentKey) {
      throw new Error(
        'Settings encryption is not configured — set SETTINGS_ENCRYPTION_KEY before writing a tenant secret.',
      );
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.currentKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(envelope: string): string {
    const { iv, tag, ciphertext } = this.parseEnvelope(envelope);
    const keys = [this.currentKey, ...this.previousKeys].filter(
      (key): key is Buffer => key !== null,
    );

    if (keys.length === 0) {
      throw new Error(
        'Settings encryption is not configured — set SETTINGS_ENCRYPTION_KEY before reading a tenant secret.',
      );
    }

    for (const key of keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        // Wrong key for this value (or genuinely tampered data) — GCM's
        // auth tag check throws rather than returning garbage. Try the
        // next candidate key before giving up below.
      }
    }

    throw new Error(
      'Failed to decrypt a settings value — it was not encrypted with the current or any previous SETTINGS_ENCRYPTION_KEY, or has been tampered with.',
    );
  }

  private parseEnvelope(envelope: string): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
    const parts = envelope.split(':');
    const [version, ivB64, tagB64, ctB64] = parts;
    // `ctB64` legitimately empty-strings for a zero-length plaintext (an
    // empty ciphertext is still valid AES-GCM output) — checked against
    // `parts.length` instead of truthiness so that case isn't mistaken
    // for a missing field the way `!ctB64` would.
    if (parts.length !== 4 || version !== ENVELOPE_VERSION || !ivB64 || !tagB64) {
      throw new Error(
        `Malformed settings encryption envelope (expected "${ENVELOPE_VERSION}:iv:tag:ciphertext").`,
      );
    }
    return {
      iv: Buffer.from(ivB64, 'base64'),
      tag: Buffer.from(tagB64, 'base64'),
      ciphertext: Buffer.from(ctB64, 'base64'),
    };
  }
}
