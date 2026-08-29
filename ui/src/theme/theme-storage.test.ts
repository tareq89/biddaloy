import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  getPersistedTheme,
  persistTheme,
  clearPersistedTheme,
  resolveTheme,
} from './theme-storage';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('theme-storage against a real localStorage', () => {
  it('returns null when nothing has been persisted yet — "follow the system"', () => {
    expect(getPersistedTheme()).toBeNull();
  });

  it('round-trips a persisted explicit choice', () => {
    persistTheme('dark');
    expect(getPersistedTheme()).toBe('dark');

    persistTheme('light');
    expect(getPersistedTheme()).toBe('light');
  });

  it('falls back to null for a corrupted stored value', () => {
    localStorage.setItem('biddaloy:theme', 'system');

    expect(getPersistedTheme()).toBeNull();
  });

  it('forgets a persisted choice, so the next read is null again', () => {
    persistTheme('dark');
    expect(getPersistedTheme()).toBe('dark');

    clearPersistedTheme();

    expect(getPersistedTheme()).toBeNull();
  });

  it('persistTheme is a silent no-op rather than throwing when storage is full', () => {
    const quotaError = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    expect(() => persistTheme('dark')).not.toThrow();
  });

  it('getPersistedTheme falls back to null rather than throwing when storage is unreadable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(getPersistedTheme()).toBeNull();
  });

  it('clearPersistedTheme is a silent no-op rather than throwing when storage is unreadable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => clearPersistedTheme()).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('an explicit stored choice always wins over the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to the OS preference when nothing was stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });
});
