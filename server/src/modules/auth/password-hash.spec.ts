import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real bcrypt, wrapped in spies so the padding work can be counted (no wall-clock asserts).
vi.mock('bcrypt', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('bcrypt');
  const mod = {
    ...real,
    compare: vi.fn(real.compare),
    hash: vi.fn(real.hash),
  };
  return { ...mod, default: mod };
});

import * as bcrypt from 'bcrypt';
import {
  BCRYPT_COST,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  padCosts,
  verifyPassword,
} from './password-hash';

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

  // [75.11 review r1, F-2319-1] A legacy cost-10 hash must cost as much as the
  // cost-12 dummy compare an unknown identifier pays, or timing tells them apart.
  describe('verifyPassword pads cheaper hashes up to BCRYPT_COST', () => {
    beforeEach(() => {
      vi.mocked(bcrypt.hash).mockClear();
      vi.mocked(bcrypt.compare).mockClear();
    });

    it('padCosts plus the real compare is exactly one BCRYPT_COST unit of work', () => {
      for (const r of [4, 8, 10, 11, 12]) {
        const work = 2 ** r + padCosts(r).reduce((sum, c) => sum + 2 ** c, 0);
        expect(work).toBe(2 ** BCRYPT_COST);
      }
      expect(padCosts(10)).toEqual([10, 11]);
      expect(padCosts(12)).toEqual([]);
      expect(padCosts(13)).toEqual([]);
    });

    it('cost-10 stored hash: one real compare plus pad hashes at cost 10 and 11', async () => {
      const stored = await bcrypt.hash('right-pass', 10);
      vi.mocked(bcrypt.hash).mockClear();

      expect(await verifyPassword('wrong-pass', stored)).toBe(false);
      expect(vi.mocked(bcrypt.compare).mock.calls).toEqual([['wrong-pass', stored]]);
      expect(vi.mocked(bcrypt.hash).mock.calls).toEqual([
        ['wrong-pass', 10],
        ['wrong-pass', 11],
      ]);

      expect(await verifyPassword('right-pass', stored)).toBe(true);
    });

    it('cost-12 stored hash: no padding', async () => {
      const stored = await hashPassword('right-pass');
      vi.mocked(bcrypt.hash).mockClear();

      expect(await verifyPassword('right-pass', stored)).toBe(true);
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('no stored hash (unknown user): compares against the cost-12 dummy and is false', async () => {
      expect(await verifyPassword('anything', null)).toBe(false);
      expect(vi.mocked(bcrypt.compare).mock.calls).toEqual([['anything', DUMMY_PASSWORD_HASH]]);
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('a malformed stored hash is false, not a throw', async () => {
      expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
    });
  });
});
