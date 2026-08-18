import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../i18n/region-config';

import { detectLoginIdentifier } from './login-identifier';

describe('detectLoginIdentifier', () => {
  it('detects a plain email', () => {
    expect(detectLoginIdentifier('rahim@greenview.edu.bd', REGION_BD_EN)).toEqual({
      kind: 'email',
      email: 'rahim@greenview.edu.bd',
    });
  });

  it('trims surrounding whitespace before detecting', () => {
    expect(detectLoginIdentifier('  rahim@greenview.edu.bd  ', REGION_BD_EN)).toEqual({
      kind: 'email',
      email: 'rahim@greenview.edu.bd',
    });
  });

  it('rejects a malformed email containing "@"', () => {
    expect(detectLoginIdentifier('not-an-email@', REGION_BD_EN)).toEqual({ kind: 'invalid' });
  });

  it('re-prefixes a bare national number with the trunk 0', () => {
    expect(detectLoginIdentifier('1712345678', REGION_BD_EN)).toEqual({
      kind: 'phone',
      phone: '01712345678',
    });
  });

  it('canonicalizes a local number with a leading trunk 0 to the same value', () => {
    expect(detectLoginIdentifier('01712345678', REGION_BD_EN)).toEqual({
      kind: 'phone',
      phone: '01712345678',
    });
  });

  it('canonicalizes an international-format number to the local trunk-0 shape', () => {
    expect(detectLoginIdentifier('+8801712345678', REGION_BD_EN)).toEqual({
      kind: 'phone',
      phone: '01712345678',
    });
  });

  it('canonicalizes a dashed, human-formatted number', () => {
    expect(detectLoginIdentifier('1712-345678', REGION_BD_EN)).toEqual({
      kind: 'phone',
      phone: '01712345678',
    });
  });

  it('rejects a too-short digit string', () => {
    expect(detectLoginIdentifier('123', REGION_BD_EN)).toEqual({ kind: 'invalid' });
  });

  it('rejects an empty string', () => {
    expect(detectLoginIdentifier('', REGION_BD_EN)).toEqual({ kind: 'invalid' });
  });

  it('rejects a whitespace-only string', () => {
    expect(detectLoginIdentifier('   ', REGION_BD_EN)).toEqual({ kind: 'invalid' });
  });
});
