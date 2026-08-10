import { describe, it, expect } from 'vitest';

import {
  getPersistedLocale,
  persistLocale,
  clearPersistedLocale,
  toSupportedLocale,
  DEFAULT_LOCALE,
} from './locale-storage';

// This file runs under the `ui:node` project — real Node, no jsdom, so
// `localStorage` genuinely does not exist as a global here (unlike a
// browser or jsdom). That's exactly the case this module has to survive:
// a first-import environment (SSR, a locked-down webview) with no
// `localStorage` at all, not just an empty one.
describe('locale-storage without a localStorage global', () => {
  it('getPersistedLocale falls back to the default rather than throwing', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(getPersistedLocale()).toBe(DEFAULT_LOCALE);
  });

  it('persistLocale is a silent no-op rather than throwing', () => {
    expect(() => persistLocale('en')).not.toThrow();
  });

  it('clearPersistedLocale is a silent no-op rather than throwing', () => {
    expect(() => clearPersistedLocale()).not.toThrow();
  });
});

// The guarantee `useLocale` leans on so `UseLocaleResult.locale` can't
// hand a consumer a tag that no locale-keyed lookup has an entry for.
// `undefined` is the case that actually bites: i18next reports no language
// at all until `init()` settles, and a raw cast would make that `undefined`
// masquerade as a `Locale` — which is how a `LOCALE_REGION_DEFAULTS[locale]`
// style lookup ends up returning `undefined` to every consumer downstream.
describe('toSupportedLocale', () => {
  it('passes through a supported locale unchanged', () => {
    expect(toSupportedLocale('en')).toBe('en');
    expect(toSupportedLocale('bn')).toBe('bn');
  });

  it('falls back to the default for no language at all', () => {
    expect(toSupportedLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(toSupportedLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it('falls back to the default for an unsupported or region-qualified tag', () => {
    expect(toSupportedLocale('fr')).toBe(DEFAULT_LOCALE);
    expect(toSupportedLocale('en-US')).toBe(DEFAULT_LOCALE);
    expect(toSupportedLocale('')).toBe(DEFAULT_LOCALE);
  });
});
