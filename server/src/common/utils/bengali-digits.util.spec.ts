import { describe, expect, it } from 'vitest';
import { toLatinDigits } from './bengali-digits.util';

describe('toLatinDigits', () => {
  it('converts every Bengali digit to its Latin equivalent', () => {
    expect(toLatinDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
  });

  it('leaves Latin digits unchanged', () => {
    expect(toLatinDigits('0123456789')).toBe('0123456789');
  });

  it('leaves non-digit characters untouched', () => {
    expect(toLatinDigits('Rahim Uddin')).toBe('Rahim Uddin');
  });

  it('converts a mixed Bengali roll number like ১০৩ to 103', () => {
    expect(toLatinDigits('১০৩')).toBe('103');
  });

  it('converts digits embedded inside otherwise Latin text', () => {
    expect(toLatinDigits('Roll ১০৩ - Class ৫')).toBe('Roll 103 - Class 5');
  });

  it('returns an empty string unchanged', () => {
    expect(toLatinDigits('')).toBe('');
  });
});
