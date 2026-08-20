import { describe, it, expect } from 'vitest';

import { getPersistedTenant, persistTenant, clearPersistedTenant } from './tenant-storage';

// This file runs under the `ui:node` project — real Node, no jsdom, so
// `localStorage` genuinely does not exist as a global here (unlike the
// browser or jsdom). That's exactly the case this module needs to survive:
// a first-import environment (SSR, a locked-down webview) with no
// `localStorage` at all, not just an empty one.
describe('tenant-storage without a localStorage global', () => {
  it('getPersistedTenant falls back to null rather than throwing', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(getPersistedTenant()).toBeNull();
  });

  it('persistTenant is a silent no-op rather than throwing', () => {
    expect(() => persistTenant('tenant-1')).not.toThrow();
  });

  it('clearPersistedTenant is a silent no-op rather than throwing', () => {
    expect(() => clearPersistedTenant()).not.toThrow();
  });
});
