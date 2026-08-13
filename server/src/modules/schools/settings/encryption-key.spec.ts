import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { buildEncryptionKey, buildPreviousEncryptionKeys } from './encryption-key';

const VALID_KEY = randomBytes(32).toString('base64');
const WRONG_LENGTH_KEY = randomBytes(16).toString('base64');

describe('buildEncryptionKey', () => {
  it('decodes a well-formed key to a 32-byte buffer', () => {
    const key = buildEncryptionKey('development', VALID_KEY);

    expect(key).toBeInstanceOf(Buffer);
    expect(key?.length).toBe(32);
  });

  it('returns null when unset outside production', () => {
    expect(buildEncryptionKey('development', undefined)).toBeNull();
    expect(buildEncryptionKey('test', undefined)).toBeNull();
  });

  it('throws when unset in production', () => {
    expect(() => buildEncryptionKey('production', undefined)).toThrow(
      /SETTINGS_ENCRYPTION_KEY must be set in production/,
    );
  });

  it('throws for a key that decodes to the wrong byte length, in every environment', () => {
    expect(() => buildEncryptionKey('development', WRONG_LENGTH_KEY)).toThrow(/32 bytes/);
    expect(() => buildEncryptionKey('production', WRONG_LENGTH_KEY)).toThrow(/32 bytes/);
  });
});

describe('buildPreviousEncryptionKeys', () => {
  it('returns an empty array when unset', () => {
    expect(buildPreviousEncryptionKeys(undefined)).toEqual([]);
    expect(buildPreviousEncryptionKeys('')).toEqual([]);
  });

  it('decodes a single previous key', () => {
    const keys = buildPreviousEncryptionKeys(VALID_KEY);

    expect(keys).toHaveLength(1);
    expect(keys[0].length).toBe(32);
  });

  it('decodes multiple comma-separated keys, ignoring blank entries', () => {
    const secondKey = randomBytes(32).toString('base64');

    const keys = buildPreviousEncryptionKeys(` ${VALID_KEY} ,,${secondKey}`);

    expect(keys).toHaveLength(2);
    expect(keys[0].equals(Buffer.from(VALID_KEY, 'base64'))).toBe(true);
    expect(keys[1].equals(Buffer.from(secondKey, 'base64'))).toBe(true);
  });

  it('throws for a malformed entry in the list', () => {
    expect(() => buildPreviousEncryptionKeys(WRONG_LENGTH_KEY)).toThrow(/32 bytes/);
  });
});
