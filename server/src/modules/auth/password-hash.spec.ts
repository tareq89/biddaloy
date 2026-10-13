import { describe, it, expect } from 'vitest';
import * as bcrypt from 'bcrypt';
import { BCRYPT_COST, DUMMY_PASSWORD_HASH, hashPassword, needsRehash } from './password-hash';

describe('password-hash', () => {
  it('uses cost 12', () => {
    expect(BCRYPT_COST).toBe(12);
  });

  it('the dummy hash has the same cost as real hashes (constant-time login for unknown users)', () => {
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(BCRYPT_COST);
  });

  it('hashPassword produces a cost-12 hash that verifies', async () => {
    const hash = await hashPassword('Some-Passw0rd!');
    expect(bcrypt.getRounds(hash)).toBe(12);
    expect(await bcrypt.compare('Some-Passw0rd!', hash)).toBe(true);
  });

  it('needsRehash is true for a cost-10 hash and false for cost 12', async () => {
    expect(needsRehash(await bcrypt.hash('x', 10))).toBe(true);
    expect(needsRehash(await hashPassword('x'))).toBe(false);
  });
});
