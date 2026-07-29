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
});
