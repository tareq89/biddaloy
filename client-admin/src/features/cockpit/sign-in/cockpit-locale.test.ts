import { describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/cockpit.json';
import en from '../../../../../ui/src/i18n/locales/en/cockpit.json';

const locales: Record<string, unknown> = { en, bn };
const read = (lang: string): unknown => locales[lang];

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Object.values(value as object).flatMap(strings);
}

// The glossary's never-say list (epic #3725, D14), plus the words the screens must not use.
const NEVER =
  /\b(TOTP|MFA|2FA|OTP|token|session|JWT|super admin|tenant|step-up|re-auth|device fingerprint|recovery key|suspend|revoke|maker-checker)\b|সেশন|টোকেন/i;

describe('cockpit sign-in words', () => {
  it.each(['en', 'bn'])('%s has no word from the never-say list', (lang) => {
    expect(strings(read(lang)).filter((s) => NEVER.test(s))).toEqual([]);
  });

  it('bn and en have the same keys', () => {
    const keys = (v: unknown, p = ''): string[] =>
      typeof v === 'string'
        ? [p]
        : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));
    expect(keys(read('bn'))).toEqual(keys(read('en')));
  });
});
