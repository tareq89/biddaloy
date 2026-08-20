import { afterEach, describe, it, expect } from 'vitest';

import { getPersistedTenant, persistTenant, clearPersistedTenant } from './tenant-storage';

afterEach(() => {
  localStorage.clear();
});

describe('tenant-storage against a real localStorage', () => {
  it('returns null when nothing has been persisted yet', () => {
    expect(getPersistedTenant()).toBeNull();
  });

  it('round-trips a persisted tenant id', () => {
    persistTenant('tenant-1');

    expect(getPersistedTenant()).toBe('tenant-1');
  });

  it('clears the persisted value', () => {
    persistTenant('tenant-1');
    clearPersistedTenant();

    expect(getPersistedTenant()).toBeNull();
  });
});
