import { describe, it, expect } from 'vitest';

import { createI18nInstance, whenReady, COMMON_NAMESPACE } from './i18n';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locale-storage';

describe('createI18nInstance', () => {
  it('defaults to bn, with the full supported locale list and common as the default namespace', async () => {
    const instance = createI18nInstance();
    await whenReady(instance);

    expect(instance.language).toBe(DEFAULT_LOCALE);
    expect(instance.options.fallbackLng).toEqual([DEFAULT_LOCALE]);
    expect(instance.options.supportedLngs).toEqual(expect.arrayContaining([...SUPPORTED_LOCALES]));
    expect(instance.options.defaultNS).toBe(COMMON_NAMESPACE);
  });

  it('loads the bundled bn common namespace through the lazy backend', async () => {
    const instance = createI18nInstance();
    await instance.loadNamespaces(COMMON_NAMESPACE);

    expect(instance.t('actions.save', { ns: COMMON_NAMESPACE })).toBe('সংরক্ষণ করুন');
  });

  it('loads the same namespace in english once switched', async () => {
    const instance = createI18nInstance();
    await instance.changeLanguage('en');
    await instance.loadNamespaces(COMMON_NAMESPACE);

    expect(instance.t('actions.save', { ns: COMMON_NAMESPACE })).toBe('Save');
  });

  it('lazily loads a feature-module namespace not in the initial ns list', async () => {
    const instance = createI18nInstance();
    await instance.changeLanguage('en');

    expect(instance.options.ns).not.toContain('students');

    await instance.loadNamespaces('students');

    expect(instance.t('feeReminder.overdue', { ns: 'students' })).toBe(
      'The enrollment fee payment deadline has passed',
    );
  });

  it('does not double-escape interpolated values — React already escapes on render', () => {
    const instance = createI18nInstance();

    expect(instance.options.interpolation?.escapeValue).toBe(false);
  });

  it('resolves immediately when called again on an already-ready instance', async () => {
    const instance = createI18nInstance();
    await whenReady(instance);

    await expect(whenReady(instance)).resolves.toBeUndefined();
  });

  it('persists a language change via the languageChanged listener', async () => {
    const instance = createI18nInstance();
    await whenReady(instance);

    await instance.changeLanguage('en');

    // No jsdom here (this spec runs under the `ui:node` project) — the
    // listener's own try/catch around a nonexistent `localStorage` is
    // what's under test: the change must not throw even though
    // persistence itself is a no-op in this environment.
    expect(instance.language).toBe('en');
  });
});
