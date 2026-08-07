import { act, render, screen, waitFor } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, it, expect } from 'vitest';

import { createI18nInstance } from './i18n';
import { I18nProvider } from './locale-provider';

function StudentsFeeReminder() {
  const { t } = useTranslation('students');
  return <p>{t('feeReminder.overdue')}</p>;
}

function CommonSaveAction() {
  const { t } = useTranslation();
  // Explicit `ns` isn't required at runtime (`useTranslation()` with no
  // argument already resolves to `defaultNS`) — it's here so
  // `check:i18n`'s per-file namespace inference doesn't attribute this key
  // to `StudentsFeeReminder`'s `useTranslation('students')` above, the
  // first (and in this file, wrong) match in the file.
  return <button>{t('actions.save', { ns: 'common' })}</button>;
}

describe('I18nProvider', () => {
  it('shows the caller-supplied fallback while a not-yet-loaded namespace resolves, then the real content', async () => {
    render(
      <I18nProvider i18n={createI18nInstance()} fallback={<p>loading-fallback</p>}>
        <StudentsFeeReminder />
      </I18nProvider>,
    );

    expect(screen.getByText('loading-fallback')).toBeTruthy();

    await waitFor(() =>
      expect(
        screen.getByText('সংশ্লিষ্ট শিক্ষার্থীর ভর্তি ফি পরিশোধের সময়সীমা উত্তীর্ণ হয়েছে'),
      ).toBeTruthy(),
    );
  });

  it('defaults to rendering nothing (not a spinner) while the fallback prop is omitted', async () => {
    // A fresh instance, same as the test above — `common` is in every
    // instance's initial `ns` list (see i18n.ts), so an instance shared
    // with another test could already have it cached by the time this
    // runs, making the "nothing renders yet" assertion below flaky rather
    // than a true test of the default fallback.
    const { container } = render(
      <I18nProvider i18n={createI18nInstance()}>
        <CommonSaveAction />
      </I18nProvider>,
    );

    // Nothing visible yet — the default fallback is `null`, not a
    // borrowed loading indicator this provider doesn't own the design of.
    expect(container.textContent).toBe('');

    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    expect(screen.getByRole('button').textContent).toBe('সংরক্ষণ করুন');
  });

  it('keeps <html lang>/<html dir> in step with the active locale, immediately on switch', async () => {
    const instance = createI18nInstance();
    render(
      <I18nProvider i18n={instance}>
        <CommonSaveAction />
      </I18nProvider>,
    );

    await waitFor(() => expect(document.documentElement.lang).toBe('bn'));
    expect(document.documentElement.dir).toBe('ltr');

    await act(async () => {
      await instance.changeLanguage('en');
    });

    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});
