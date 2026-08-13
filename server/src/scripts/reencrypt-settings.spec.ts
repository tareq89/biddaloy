import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionService } from '../modules/schools/settings/encryption.service';
import { migrateSchools } from './reencrypt-settings.util';

function key(): Buffer {
  return randomBytes(32);
}

describe('migrateSchools', () => {
  it('encrypts a legacy plaintext secret and reports it as migrated', async () => {
    const encryption = new EncryptionService(key());
    const school = {
      id: 's1',
      settings: { communications: { whatsapp: { accessToken: 'legacy-plaintext-token' } } },
    };
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await migrateSchools([school], encryption, save);

    expect(result).toEqual({ migrated: 1, skipped: 0 });
    expect(save).toHaveBeenCalledTimes(1);
    const accessToken = (school.settings.communications.whatsapp as any).accessToken;
    expect(encryption.decrypt(accessToken)).toBe('legacy-plaintext-token');
  });

  it('re-encrypts a previous-key secret onto the current key and reports it as migrated', async () => {
    const oldKey = key();
    const newKey = key();
    const envelope = new EncryptionService(oldKey).encrypt('rotate-me');
    const rotatedEncryption = new EncryptionService(newKey, [oldKey]);
    const school = {
      id: 's1',
      settings: { communications: { whatsapp: { accessToken: envelope } } },
    };
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await migrateSchools([school], rotatedEncryption, save);

    expect(result).toEqual({ migrated: 1, skipped: 0 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      rotatedEncryption.isCurrent((school.settings.communications.whatsapp as any).accessToken),
    ).toBe(true);
  });

  it('leaves an orphaned secret untouched, does not save, and reports it as skipped', async () => {
    const abandonedKey = key();
    const orphaned = new EncryptionService(abandonedKey).encrypt('orphaned');
    const currentEncryption = new EncryptionService(key());
    const school = {
      id: 's1',
      settings: { communications: { whatsapp: { accessToken: orphaned } } },
    };
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await migrateSchools([school], currentEncryption, save);

    expect(result).toEqual({ migrated: 0, skipped: 1 });
    expect(save).not.toHaveBeenCalled();
    expect((school.settings.communications.whatsapp as any).accessToken).toBe(orphaned);
  });

  it('does not save or count a school already fully on the current key', async () => {
    const encryption = new EncryptionService(key());
    const envelope = encryption.encrypt('already-current');
    const school = {
      id: 's1',
      settings: { communications: { whatsapp: { accessToken: envelope } } },
    };
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await migrateSchools([school], encryption, save);

    expect(result).toEqual({ migrated: 0, skipped: 0 });
    expect(save).not.toHaveBeenCalled();
  });

  it('skips a school with no stored settings entirely', async () => {
    const encryption = new EncryptionService(key());
    const school = { id: 's1', settings: null };
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await migrateSchools([school], encryption, save);

    expect(result).toEqual({ migrated: 0, skipped: 0 });
    expect(save).not.toHaveBeenCalled();
  });
});
