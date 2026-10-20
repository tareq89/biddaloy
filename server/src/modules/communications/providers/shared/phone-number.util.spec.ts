import { describe, it, expect } from 'vitest';
import { normalizeBdPhoneNumber } from './phone-number.util';

describe('normalizeBdPhoneNumber', () => {
  it('normalizes a local-format number', () => {
    expect(normalizeBdPhoneNumber('01712345678')).toBe('8801712345678');
  });

  it('normalizes a +-prefixed number', () => {
    expect(normalizeBdPhoneNumber('+8801712345678')).toBe('8801712345678');
  });

  it('normalizes an already-country-coded number', () => {
    expect(normalizeBdPhoneNumber('8801712345678')).toBe('8801712345678');
  });

  it('normalizes a 00-prefixed number', () => {
    expect(normalizeBdPhoneNumber('008801712345678')).toBe('8801712345678');
  });

  it('strips spaces and dashes', () => {
    expect(normalizeBdPhoneNumber('017-1234 5678')).toBe('8801712345678');
  });

  it('is idempotent, including for a non-BD-shaped input', () => {
    const once = normalizeBdPhoneNumber('1300012345');
    expect(normalizeBdPhoneNumber(once)).toBe(once);
  });

  it('returns an empty string when the input has no digits, not "88"', () => {
    expect(normalizeBdPhoneNumber('call-me-maybe')).toBe('');
    expect(normalizeBdPhoneNumber('')).toBe('');
  });

  it('still normalizes every valid BD shape to the same canonical number', () => {
    for (const input of ['01712345678', '+8801712345678', '008801712345678', '8801712345678']) {
      expect(normalizeBdPhoneNumber(input)).toBe('8801712345678');
    }
  });
});
