import { describe, it, expect } from 'vitest';
import { isSmsAllowed, toE164ish } from './phone-delivery.util';

describe('phone-delivery.util (D31)', () => {
  it('normalises 00-prefix and Bangladesh local numbers', () => {
    expect(toE164ish('008801712345678')).toBe('+8801712345678');
    expect(toE164ish('01712345678')).toBe('+8801712345678');
    expect(toE164ish('+8801712345678')).toBe('+8801712345678');
  });

  it('allows BD numbers in any common shape by default', () => {
    for (const p of ['01712345678', '+8801712345678', '008801712345678']) {
      expect(isSmsAllowed(p, '+880')).toBe(true);
    }
  });

  it('refuses foreign numbers, and non-BD numbers typed without a plus', () => {
    expect(isSmsAllowed('+14155550100', '+880')).toBe(false);
    expect(isSmsAllowed('0014155550100', '+880')).toBe(false);
    expect(isSmsAllowed('4155550100', '+880')).toBe(false);
    expect(isSmsAllowed('02123456789', '+880')).toBe(false);
  });

  it('honours a configured prefix list', () => {
    expect(isSmsAllowed('+14155550100', '+880, +1')).toBe(true);
  });
});
