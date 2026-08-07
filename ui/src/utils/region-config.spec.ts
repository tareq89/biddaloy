import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from './region-config';

describe('REGION_BD_BN / REGION_BD_EN', () => {
  it('bn-BD uses Bengali numerals, lakh-crore grouping, and a ৳ prefix', () => {
    expect(REGION_BD_BN.locale).toBe('bn-BD');
    expect(REGION_BD_BN.numerals).toBe('bengali');
    expect(REGION_BD_BN.currency.grouping).toBe('lakh-crore');
    expect(REGION_BD_BN.currency.symbol).toBe('৳');
    expect(REGION_BD_BN.currency.position).toBe('prefix');
  });

  it('en-BD shares the regional rules with en-BD swapped for Latin numerals', () => {
    expect(REGION_BD_EN.locale).toBe('en-BD');
    expect(REGION_BD_EN.numerals).toBe('latin');
    expect(REGION_BD_EN.currency).toEqual(REGION_BD_BN.currency);
    expect(REGION_BD_EN.phone).toBe(REGION_BD_BN.phone);
  });
});
