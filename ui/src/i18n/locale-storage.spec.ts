import { describe, it, expect } from 'vitest';

import { getPersistedLocale, persistLocale, DEFAULT_LOCALE } from './locale-storage';

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
});
