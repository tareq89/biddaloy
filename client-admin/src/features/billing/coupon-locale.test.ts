import { describe, expect, it } from 'vitest';

import bn from '../../../../ui/src/i18n/locales/bn/billing.json';
import en from '../../../../ui/src/i18n/locales/en/billing.json';

// docs/ux-research/cockpit-money-glossary.md, "Never say": words that must not reach a school admin.
const NEVER_SAY = ['bundle', 'stock', 'lot', 'ledger', 'allocation', 'voucher', 'promo code'];

describe('billing coupon strings', () => {
  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s: every coupon.* string is free of never-say words, and en/bn keys match', (_l, json) => {
    const values = Object.values(json.coupon);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      for (const word of NEVER_SAY)
        expect(v.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    expect(Object.keys(json.coupon).sort()).toEqual(Object.keys(en.coupon).sort());
  });
});
