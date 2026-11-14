// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyTenantWords, applyTenantWordsWhenLoaded } from './tenant-words';

import { createI18nInstance, whenReady } from './index';

async function setup(lng: 'en' | 'bn') {
  const i18n = createI18nInstance();
  await whenReady(i18n);
  await i18n.changeLanguage(lng);
  return i18n;
}
const t = (i18n: Awaited<ReturnType<typeof setup>>, key: string, count: number) =>
  i18n.t(`entities.${key}`, { ns: 'common', count });

describe('applyTenantWords', () => {
  it('section -> Batch in en (one/other) and bn word for both forms', async () => {
    const labels = { section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' } };
    const en = await setup('en');
    applyTenantWords(en, labels);
    expect(t(en, 'section', 1)).toBe('Batch');
    expect(t(en, 'section', 2)).toBe('Batches');
    const bn = await setup('bn');
    applyTenantWords(bn, labels);
    expect(t(bn, 'section', 1)).toBe('ব্যাচ');
    expect(t(bn, 'section', 2)).toBe('ব্যাচ');
  });

  it('blank word keeps the stock word', async () => {
    const i18n = await setup('en');
    applyTenantWords(i18n, { class: { en: { one: '  ', other: '' } } });
    expect(t(i18n, 'class', 1)).toBe('Class');
    expect(t(i18n, 'class', 2)).toBe('Classes');
  });

  it('removal restores stock words', async () => {
    const i18n = await setup('en');
    applyTenantWords(i18n, { student: { en: { one: 'Trainee', other: 'Trainees' } } });
    expect(t(i18n, 'student', 2)).toBe('Trainees');
    applyTenantWords(i18n, {});
    expect(t(i18n, 'student', 1)).toBe('Student');
    expect(t(i18n, 'student', 2)).toBe('Students');
  });

  it('leaves other keys untouched', async () => {
    const i18n = await setup('en');
    applyTenantWords(i18n, { teacher: { en: { one: 'Instructor', other: 'Instructors' } } });
    expect(t(i18n, 'guardian', 1)).toBe('Guardian');
  });
});

describe('applyTenantWordsWhenLoaded', () => {
  it('waits for the bn bundle, so removing a label later restores the stock word', async () => {
    const i18n = await setup('en');
    // bn `common` is not loaded yet: drop it, and let loadLanguages bring it back later.
    const bundle = i18n.getResourceBundle('bn', 'common');
    i18n.removeResourceBundle('bn', 'common');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = i18n.loadLanguages.bind(i18n);
    i18n.loadLanguages = (async (l: string | readonly string[]) => {
      if (l === 'bn') {
        await gate;
        i18n.addResourceBundle('bn', 'common', bundle);
      }
      return load(l as string);
    }) as typeof i18n.loadLanguages;

    const done = applyTenantWordsWhenLoaded(i18n, { class: { bn: 'শ্রেণি২' } });
    expect(i18n.hasResourceBundle('bn', 'common')).toBe(false); // nothing written early
    release();
    expect(await done).toBe(true);
    await i18n.changeLanguage('bn');
    expect(t(i18n, 'class', 1)).toBe('শ্রেণি২');
    applyTenantWords(i18n, {});
    expect(t(i18n, 'class', 1)).toBe(bundle.entities.class_one);
  });

  it('a failed load applies nothing and leaves no partial bundle', async () => {
    const i18n = await setup('en');
    i18n.removeResourceBundle('bn', 'common');
    i18n.loadLanguages = (async () => {
      throw new Error('offline');
    }) as typeof i18n.loadLanguages;
    expect(await applyTenantWordsWhenLoaded(i18n, { class: { bn: 'X' } })).toBe(false);
    expect(i18n.hasResourceBundle('bn', 'common')).toBe(false);
  });
});
