import { describe, expect, it } from 'vitest';

import { formatPhone, parsePhone } from './phone';
import { REGION_BD_EN } from './region-config';

describe('parsePhone', () => {
  it('accepts a local number with a leading trunk 0', () => {
    expect(parsePhone('01712345678', REGION_BD_EN)).toEqual({ valid: true, value: '1712345678' });
  });

  it('accepts an international number with the country code', () => {
    expect(parsePhone('+8801712345678', REGION_BD_EN)).toEqual({
      valid: true,
      value: '1712345678',
    });
  });

  it('accepts a bare national number with neither prefix', () => {
    expect(parsePhone('1712345678', REGION_BD_EN)).toEqual({ valid: true, value: '1712345678' });
  });

  it('strips formatting punctuation and accepts Bengali digits', () => {
    expect(parsePhone('০১৭১২-৩৪৫৬৭৮', REGION_BD_EN)).toEqual({ valid: true, value: '1712345678' });
  });

  it('fails predictably on a too-short number rather than mangling it', () => {
    const result = parsePhone('123', REGION_BD_EN);
    expect(result.valid).toBe(false);
  });

  it('fails predictably on a number not starting with a valid mobile prefix', () => {
    const result = parsePhone('2712345678', REGION_BD_EN);
    expect(result.valid).toBe(false);
  });
});

describe('formatPhone', () => {
  it('formats a valid national number as +880 1XXX-XXXXXX', () => {
    expect(formatPhone('01712345678', REGION_BD_EN)).toBe('+880 1712-345678');
  });

  it('throws on an invalid number rather than returning a mangled string', () => {
    expect(() => formatPhone('123', REGION_BD_EN)).toThrow(RangeError);
  });
});
