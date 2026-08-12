import { afterEach, describe, it, expect } from 'vitest';

import { getPersistedLocale, persistLocale, DEFAULT_LOCALE } from './locale-storage';

afterEach(() => {
  localStorage.clear();
});

describe('locale-storage against a real localStorage', () => {
  it('defaults when nothing has been persisted yet', () => {
    expect(getPersistedLocale()).toBe(DEFAULT_LOCALE);
  });

  it('round-trips a persisted, supported locale', () => {
    persistLocale('en');

    expect(getPersistedLocale()).toBe('en');
  });

  it('falls back to the default for a corrupted stored value', () => {
    localStorage.setItem('biddaloy:locale', 'fr');

    expect(getPersistedLocale()).toBe(DEFAULT_LOCALE);
  });
});
