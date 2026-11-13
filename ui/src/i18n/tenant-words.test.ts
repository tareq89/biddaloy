// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyTenantWords } from './tenant-words';

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
