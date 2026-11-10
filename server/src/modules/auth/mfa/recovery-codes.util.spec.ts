import { describe, it, expect } from 'vitest';
import { RECOVERY_ALPHABET, generateCodes, hashCode, normalise } from './recovery-codes.util';

describe('recovery-codes.util', () => {
  it('makes ten distinct codes in abcd-efgh-jkmn-pqrs shape using the safe alphabet', () => {
    const codes = generateCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
      for (const ch of c.replace(/-/g, '')) expect(RECOVERY_ALPHABET).toContain(ch);
    }
    // No look-alike characters.
    expect(RECOVERY_ALPHABET).not.toMatch(/[01oil]/);
  });

  it('normalises case, spaces and dashes', () => {
    expect(normalise('ABCD-efgh jkmn-pqrs')).toBe('abcd-efgh-jkmn-pqrs');
    expect(hashCode('ABCD-efgh jkmn-pqrs')).toBe(hashCode('abcd-efgh-jkmn-pqrs'));
  });

  it('hashes to 64 hex chars (matches the CHECK constraint)', () => {
    expect(hashCode('abcd-efgh-jkmn-pqrs')).toMatch(/^[0-9a-f]{64}$/);
  });
});
