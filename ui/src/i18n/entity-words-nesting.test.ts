// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyTenantWords } from './tenant-words';

import { createI18nInstance, whenReady } from './index';

// D49: page copy nests `$t(common:entities.*)`; this pins that the nesting
// follows the tenant override, across namespaces, both locales, both plural forms.
async function setup(lng: 'en' | 'bn') {
  const i18n = createI18nInstance();
  await whenReady(i18n);
  await i18n.changeLanguage(lng);
  await i18n.loadNamespaces('students');
  i18n.addResourceBundle(
    lng,
    'students',
    {
      probeOne:
        lng === 'en'
          ? 'Open the $t(common:entities.section_one)'
          : 'খুলুন $t(common:entities.section_one)',
      probeMany:
        lng === 'en'
          ? 'All $t(common:entities.section_other)'
          : 'সব $t(common:entities.section_other)',
      probeCount: 'Open the $t(common:entities.section_one)',
    },
    true,
    true,
  );
  return i18n;
}

describe('entity-word nesting', () => {
  // One language per labels object: the loaded JSON modules are shared between instances, so an
  // override applied for en in one test would otherwise leak its bn word into the next.
  const enLabels = { section: { en: { one: 'Batch', other: 'Batches' } } };
  const bnLabels = { section: { bn: 'ব্যাচ' } };

  it('en: stock word, then school word (one + other), from a non-common namespace', async () => {
    const i18n = await setup('en');
    expect(i18n.t('probeOne', { ns: 'students' })).toBe('Open the Section');
    applyTenantWords(i18n, enLabels);
    expect(i18n.t('probeOne', { ns: 'students' })).toBe('Open the Batch');
    expect(i18n.t('probeMany', { ns: 'students' })).toBe('All Batches');
    // an outer count must not break the explicit _one suffix lookup
    expect(i18n.t('probeCount', { ns: 'students', count: 5 })).toBe('Open the Batch');
  });

  it('bn: one word for both forms', async () => {
    const i18n = await setup('bn');
    expect(i18n.t('probeOne', { ns: 'students' })).toBe('খুলুন শাখা');
    applyTenantWords(i18n, bnLabels);
    expect(i18n.t('probeOne', { ns: 'students' })).toBe('খুলুন ব্যাচ');
    expect(i18n.t('probeMany', { ns: 'students' })).toBe('সব ব্যাচ');
  });
});
