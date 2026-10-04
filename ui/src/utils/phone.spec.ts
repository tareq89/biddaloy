import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';

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
  it('formats a valid national number as 01XXX-XXXXXX', () => {
    expect(formatPhone('01712345678', REGION_BD_EN)).toBe('01712-345678');
  });

  it('shows an invalid number as typed', () => {
    expect(formatPhone('123', REGION_BD_EN)).toBe('123');
  });

  it.each(['', null, undefined, '   '])('shows the none value for %j', (value) => {
    expect(formatPhone(value, REGION_BD_EN)).toBe('—');
  });

  it('formats an international number and Bengali digits to Latin', () => {
    expect(formatPhone('+8801711000004', REGION_BD_EN)).toBe('01711-000004');
    expect(formatPhone('০১৭১১-০০০০০৪', REGION_BD_BN)).toBe('01711-000004');
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

    expect(formatPhone('01712345678', tooManyPlaceholders)).toBe('1712-345678');
  });

  it('appends digits the mask has no placeholder left for, rather than dropping them', () => {
    // The inverse config-authoring mistake: fewer X's than the pattern
    // guarantees digits for. formatPhone can shorten formatting but must
    // never lose data — a truncated phone number is silently wrong in a
    // way nothing downstream would catch.
    const tooFewPlaceholders = {
      ...REGION_BD_EN,
      phone: { ...REGION_BD_EN.phone, displayFormat: 'XXX-XXXX' },
    };

    expect(formatPhone('01712345678', tooFewPlaceholders)).toBe('171-2345678');
  });
});
