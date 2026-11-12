import { describe, it, expect } from 'vitest';
import { readSupportAccess, withSupportAccess } from './support-access-settings';
import { DEFAULT_SUPPORT_ACCESS_SETTINGS } from './tenant-settings-defaults';

const VALID = {
  mode: 'ask',
  confirmedAt: '2026-01-02T03:04:05.000Z',
  confirmedBy: 'u1',
  textVersion: 2,
};

describe('readSupportAccess [99.1.04]', () => {
  it('defaults when absent or null', () => {
    expect(readSupportAccess({})).toEqual(DEFAULT_SUPPORT_ACCESS_SETTINGS);
    expect(readSupportAccess(null)).toEqual(DEFAULT_SUPPORT_ACCESS_SETTINGS);
  });
  it('returns a valid stored value', () => {
    expect(readSupportAccess({ supportAccess: VALID })).toEqual(VALID);
  });
  it('falls back to the default on a garbage mode', () => {
    expect(readSupportAccess({ supportAccess: { ...VALID, mode: 'NONSENSE' } })).toEqual(
      DEFAULT_SUPPORT_ACCESS_SETTINGS,
    );
  });
  it('nulls a bad date', () => {
    const out = readSupportAccess({ supportAccess: { ...VALID, confirmedAt: 'nope' } });
    expect(out.confirmedAt).toBeNull();
  });
  it('resets a negative or fractional version', () => {
    expect(readSupportAccess({ supportAccess: { ...VALID, textVersion: -1 } }).textVersion).toBe(0);
    expect(readSupportAccess({ supportAccess: { ...VALID, textVersion: 1.5 } }).textVersion).toBe(
      0,
    );
  });
});

describe('withSupportAccess [99.1.04]', () => {
  it('replaces the key and keeps the others', () => {
    const out = withSupportAccess({ fees: { a: 1 } }, readSupportAccess({ supportAccess: VALID }));
    expect(out).toEqual({ fees: { a: 1 }, supportAccess: VALID });
  });
});
