import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionService } from '../modules/schools/settings/encryption.service';
import { migrateMfa } from './reencrypt-settings.util';

describe('migrateMfa', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const previous = new EncryptionService(oldKey);
  const rotated = new EncryptionService(newKey, [oldKey]);

  it('re-encrypts a secret held under the previous key and keeps the plaintext', async () => {
    const row = { user_id: 'u1', secret_enc: previous.encrypt('JBSWY3DPEHPK3PXP') };
    const save = vi.fn(async () => undefined);
    const result = await migrateMfa([row], rotated, save);
    expect(result).toEqual({ migrated: 1, skipped: 0 });
    expect(rotated.isCurrent(row.secret_enc)).toBe(true);
    expect(rotated.decrypt(row.secret_enc)).toBe('JBSWY3DPEHPK3PXP');
    expect(save).toHaveBeenCalledOnce();
  });

  it('leaves a secret already on the current key alone (safe to re-run)', async () => {
    const row = { user_id: 'u1', secret_enc: rotated.encrypt('X') };
    const save = vi.fn(async () => undefined);
    expect(await migrateMfa([row], rotated, save)).toEqual({ migrated: 0, skipped: 0 });
    expect(save).not.toHaveBeenCalled();
  });

  it('counts a secret no key can decrypt as skipped, without saving', async () => {
    const stranger = new EncryptionService(randomBytes(32));
    const row = { user_id: 'u2', secret_enc: stranger.encrypt('X') };
    const save = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await migrateMfa([row], rotated, save)).toEqual({ migrated: 0, skipped: 1 });
    expect(save).not.toHaveBeenCalled();
    // The warning must not leak the ciphertext.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(row.secret_enc);
    warn.mockRestore();
  });
});
