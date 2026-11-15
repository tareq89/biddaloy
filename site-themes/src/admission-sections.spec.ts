import { SitePage, SiteSectionKey } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { THEMES, defaultConfigFor, validateSiteConfig } from './index';

const KEYS = [
  SiteSectionKey.ADMISSIONS,
  SiteSectionKey.ADMISSION_RESULT,
  SiteSectionKey.ADMISSION_LISTS,
];

describe.each(Object.values(THEMES))('$id theme: admission sections', (m) => {
  it('lists all three sections; Apply is on by default, result and lists are off', () => {
    for (const key of KEYS)
      expect(
        m.sections.some((s) => s.key === key),
        key,
      ).toBe(true);
    const page = defaultConfigFor(m.id).pages.find((p) => p.page === SitePage.ADMISSIONS)!;
    const on = (k: SiteSectionKey) => page.sections.find((s) => s.key === k)!.enabled;
    expect(on(SiteSectionKey.ADMISSIONS)).toBe(true);
    expect(on(SiteSectionKey.ADMISSION_RESULT)).toBe(false);
    expect(on(SiteSectionKey.ADMISSION_LISTS)).toBe(false);
  });

  it('the default config validates with the new keys', () => {
    expect(validateSiteConfig(defaultConfigFor(m.id), m).ok).toBe(true);
  });
});
