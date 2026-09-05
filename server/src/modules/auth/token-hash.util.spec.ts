import { describe, it, expect } from 'vitest';
import { generateSecret, hashSecret, safeEqualHex } from './token-hash.util';

describe('token-hash.util', () => {
  describe('generateSecret', () => {
    it('produces a base64url string with no padding characters', () => {
      const secret = generateSecret();
      expect(secret).not.toContain('=');
      expect(secret).not.toContain('+');
      expect(secret).not.toContain('/');
    });

    it('never repeats', () => {
      const a = generateSecret();
      const b = generateSecret();
      expect(a).not.toEqual(b);
    });
  });

  describe('hashSecret', () => {
    it('produces a 64-char hex digest', () => {
      const hash = hashSecret('some-secret');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      expect(hashSecret('same')).toEqual(hashSecret('same'));
    });

    it('differs for different inputs', () => {
      expect(hashSecret('a')).not.toEqual(hashSecret('b'));
    });
  });

  describe('safeEqualHex', () => {
    it('returns true for identical hex strings', () => {
      const hash = hashSecret('x');
      expect(safeEqualHex(hash, hash)).toBe(true);
    });

    it('returns false for different hex strings of the same length', () => {
      expect(safeEqualHex(hashSecret('a'), hashSecret('b'))).toBe(false);
    });

    it('returns false on length mismatch without throwing', () => {
      expect(() => safeEqualHex('ab', 'abcd')).not.toThrow();
      expect(safeEqualHex('ab', 'abcd')).toBe(false);
    });
  });
});
