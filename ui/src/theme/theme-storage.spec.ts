import { describe, it, expect } from 'vitest';

import { getPersistedTheme, persistTheme, clearPersistedTheme } from './theme-storage';

// This file runs under the `ui:node` project — real Node, no jsdom, so
// `localStorage` genuinely does not exist as a global here (unlike a
// browser or jsdom). That's exactly the case this module has to survive:
// a first-import environment (SSR, a locked-down webview) with no
// `localStorage` at all, not just an empty one. Mirrors
// `ui/src/i18n/locale-storage.spec.ts`.
describe('theme-storage without a localStorage global', () => {
  it('getPersistedTheme falls back to null rather than throwing', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(getPersistedTheme()).toBeNull();
  });

  it('persistTheme is a silent no-op rather than throwing', () => {
    expect(() => persistTheme('dark')).not.toThrow();
  });

  it('clearPersistedTheme is a silent no-op rather than throwing', () => {
    expect(() => clearPersistedTheme()).not.toThrow();
  });
});
