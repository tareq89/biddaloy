import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';

function key(): Buffer {
  return randomBytes(32);
}

describe('EncryptionService', () => {
  describe('encrypt/decrypt round trip', () => {
    it('recovers the original plaintext', () => {
      const service = new EncryptionService(key());

      const envelope = service.encrypt('a-whatsapp-access-token');

      expect(service.decrypt(envelope)).toBe('a-whatsapp-access-token');
    });

    it('produces a self-describing envelope string, not the object form', () => {
      const service = new EncryptionService(key());

      const envelope = service.encrypt('secret');

      expect(typeof envelope).toBe('string');
      expect(envelope.split(':')).toHaveLength(4);
      expect(envelope.startsWith('gcmv1:')).toBe(true);
    });

    it('never reuses an IV across two encryptions of the same plaintext', () => {
      const service = new EncryptionService(key());

      const first = service.encrypt('same-value');
      const second = service.encrypt('same-value');

      expect(first).not.toBe(second);
      const [, firstIv] = first.split(':');
      const [, secondIv] = second.split(':');
      expect(firstIv).not.toBe(secondIv);
    });

    it('handles an empty string plaintext', () => {
      const service = new EncryptionService(key());

      expect(service.decrypt(service.encrypt(''))).toBe('');
    });
  });

  describe('tamper detection', () => {
    it('rejects a ciphertext that was altered after encryption', () => {
      const service = new EncryptionService(key());
      const envelope = service.encrypt('secret');
      const [version, iv, tag, ciphertext] = envelope.split(':');
      const tamperedByte = Buffer.from(ciphertext, 'base64');
      tamperedByte[0] ^= 0xff;
      const tampered = [version, iv, tag, tamperedByte.toString('base64')].join(':');

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('rejects a malformed envelope', () => {
      const service = new EncryptionService(key());

      expect(() => service.decrypt('not-a-real-envelope')).toThrow(/Malformed/);
    });

    it('rejects an envelope with the wrong version prefix', () => {
      const service = new EncryptionService(key());
      const envelope = service.encrypt('secret');
      const [, iv, tag, ciphertext] = envelope.split(':');

      expect(() => service.decrypt(['gcmv2', iv, tag, ciphertext].join(':'))).toThrow(/Malformed/);
    });
  });

  describe('no key configured', () => {
    it('throws on encrypt', () => {
      const service = new EncryptionService(null);

      expect(() => service.encrypt('secret')).toThrow(/not configured/);
    });

    it('throws on decrypt', () => {
      const service = new EncryptionService(null);

      expect(() => service.decrypt('gcmv1:a:b:c')).toThrow(/not configured/);
    });
  });

  describe('key rotation', () => {
    it('decrypts a value encrypted under a previous key once the current key has rotated', () => {
      const oldKey = key();
      const newKey = key();
      const beforeRotation = new EncryptionService(oldKey);
      const envelope = beforeRotation.encrypt('rotate-me');

      const afterRotation = new EncryptionService(newKey, [oldKey]);

      expect(afterRotation.decrypt(envelope)).toBe('rotate-me');
    });

    it('encrypts new values under the current key, not a previous one', () => {
      const oldKey = key();
      const newKey = key();
      const afterRotation = new EncryptionService(newKey, [oldKey]);

      const envelope = afterRotation.encrypt('freshly-written');

      // Decryptable by an instance holding only the new key — proves the
      // write used `newKey`, not `oldKey`.
      const newKeyOnly = new EncryptionService(newKey);
      expect(newKeyOnly.decrypt(envelope)).toBe('freshly-written');
    });

    it('throws once no configured key (current or previous) matches', () => {
      const abandonedKey = key();
      const envelope = new EncryptionService(abandonedKey).encrypt('orphaned');

      const afterFullRotation = new EncryptionService(key(), [key()]);

      expect(() => afterFullRotation.decrypt(envelope)).toThrow(/Failed to decrypt/);
    });
  });
});
