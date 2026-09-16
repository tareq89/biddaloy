import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  clearPersistedPrintFormat,
  getPersistedPrintFormat,
  persistPrintFormat,
} from './invoice-print-format';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('invoice-print-format against a real localStorage', () => {
  it('returns null when nothing has been persisted yet', () => {
    expect(getPersistedPrintFormat()).toBeNull();
  });

  it('round-trips a persisted format across all three formats', () => {
    persistPrintFormat('a4');
    expect(getPersistedPrintFormat()).toBe('a4');

    persistPrintFormat('pos80');
    expect(getPersistedPrintFormat()).toBe('pos80');

    persistPrintFormat('pos58');
    expect(getPersistedPrintFormat()).toBe('pos58');
  });

  it('falls back to null for a corrupted stored value', () => {
    localStorage.setItem('biddaloy:invoice-print-format', 'legal');

    expect(getPersistedPrintFormat()).toBeNull();
  });

  it('forgets a persisted choice, so the next read is null again', () => {
    persistPrintFormat('pos58');
    expect(getPersistedPrintFormat()).toBe('pos58');

    clearPersistedPrintFormat();

    expect(getPersistedPrintFormat()).toBeNull();
  });

  it('persistPrintFormat is a silent no-op rather than throwing when storage is full', () => {
    const quotaError = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    expect(() => persistPrintFormat('a4')).not.toThrow();
  });

  it('getPersistedPrintFormat falls back to null rather than throwing when storage is unreadable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(getPersistedPrintFormat()).toBeNull();
  });

  it('clearPersistedPrintFormat is a silent no-op rather than throwing when storage is unreadable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => clearPersistedPrintFormat()).not.toThrow();
  });
});
