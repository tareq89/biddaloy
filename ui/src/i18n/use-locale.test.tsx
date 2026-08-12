import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { createI18nInstance } from './i18n';
import { I18nProvider } from './locale-provider';
import { useLocale } from './use-locale';

// Each test gets its own instance *and* a clean storage key. Both halves
// matter: the shared singleton would carry this test's `en` into every
// later one, and `createI18nInstance()` seeds `lng` from
// `getPersistedLocale()`, so a leftover key would decide which language a
// "fresh" instance starts in.
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

function LocaleSwitcher() {
  const { locale, setLocale } = useLocale();
  const { t } = useTranslation();
  return (
    <div>
      <p>current: {locale}</p>
      <p>{t('actions.save')}</p>
      <button onClick={() => setLocale(locale === 'bn' ? 'en' : 'bn')}>Switch</button>
    </div>
  );
}

describe('useLocale', () => {
  it('switches the active locale, re-rendering translated content, and persists the choice', async () => {
    render(
      <I18nProvider i18n={createI18nInstance()}>
        <LocaleSwitcher />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText('current: bn')).toBeTruthy());
    expect(screen.getByText('সংরক্ষণ করুন')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));

    await waitFor(() => expect(screen.getByText('current: en')).toBeTruthy());
    expect(screen.getByText('Save')).toBeTruthy();
    expect(localStorage.getItem('biddaloy:locale')).toBe('en');
  });
});
