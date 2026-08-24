import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

import { formatGuardianPhone } from './-format-guardian-phone';

describe('formatGuardianPhone', () => {
  it('[8.11.4] formats a valid phone per RegionConfig', () => {
    expect(formatGuardianPhone('+8801712345678', REGION_BD_EN)).toBe('+880 1712-345678');
  });

  it('returns null for a guardian with no phone on file', () => {
    expect(formatGuardianPhone(null, REGION_BD_EN)).toBeNull();
  });

  it('falls back to the raw stored value for a number that does not parse', () => {
    // Pre-dates RegionConfig validation (an imported roster, a free-typed
    // number) — must not throw the way `formatPhone` itself would.
    expect(formatGuardianPhone('not-a-phone', REGION_BD_EN)).toBe('not-a-phone');
  });
});
