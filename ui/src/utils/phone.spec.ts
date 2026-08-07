import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../i18n/region-config';

import { formatPhone, parsePhone } from './phone';

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

  it('drops a mask placeholder that has no digit left for it, rather than throwing', () => {
    // A displayFormat with more X's than the pattern guarantees digits for
    // is a config authoring mistake, not something formatPhone should
    // crash on — the two fields are independently authored and only
    // agree by convention, not by type.
    const tooManyPlaceholders = {
      ...REGION_BD_EN,
      phone: { ...REGION_BD_EN.phone, displayFormat: 'XXXX-XXXXXXX' },
    };

    expect(formatPhone('01712345678', tooManyPlaceholders)).toBe('+880 1712-345678');
  });
});
