import { describe, it, expect } from 'vitest';
import { normalizeLoginIdentifier } from './normalize-identifier';

describe('normalizeLoginIdentifier', () => {
  // The whole point: User@x.com and user@x.com must share one lockout bucket.
  it('lowercases the identifier', () => {
    expect(normalizeLoginIdentifier('User@Test.com')).toBe('user@test.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLoginIdentifier('  admin@test.com  ')).toBe('admin@test.com');
  });

  it('leaves an already-normalized identifier unchanged', () => {
    expect(normalizeLoginIdentifier('admin@test.com')).toBe('admin@test.com');
  });

  it('is a no-op on a phone number', () => {
    expect(normalizeLoginIdentifier('+8801700000000')).toBe('+8801700000000');
  });
});
