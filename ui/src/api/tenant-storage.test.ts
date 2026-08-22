import { UserRole } from '@biddaloy/shared';
import { afterEach, describe, it, expect } from 'vitest';

import { getPersistedTenant, persistTenant, clearPersistedTenant } from './tenant-storage';

afterEach(() => {
  localStorage.clear();
});

describe('tenant-storage against a real localStorage', () => {
  it('returns null when nothing has been persisted yet', () => {
    expect(getPersistedTenant()).toBeNull();
  });

  it('round-trips a persisted tenant and role', () => {
    persistTenant('tenant-1', UserRole.PARENT);

    expect(getPersistedTenant()).toEqual({ tenantId: 'tenant-1', role: UserRole.PARENT });
  });

  it('round-trips a tenant persisted without a role', () => {
    persistTenant('tenant-1');

    expect(getPersistedTenant()).toEqual({ tenantId: 'tenant-1', role: null });
  });

  it('reads a pre-[8.9.11] bare tenant id as a roleless choice rather than throwing', () => {
    // Exactly what a returning user's browser still holds: the value shape
    // this module wrote before it stored the role — a raw UUID, not JSON.
    localStorage.setItem('biddaloy:activeTenant', 'tenant-1');

    expect(getPersistedTenant()).toEqual({ tenantId: 'tenant-1', role: null });
  });

  // Not the same as a roleless value: this one *named* a role, we just
  // can't resolve it. Reporting `role: null` would make `restoreActiveTenant`
  // match on tenant alone and restore whichever role the token lists first —
  // the behaviour [8.9.11] exists to stop. Dropping the whole value leaves
  // the choice unresolved, and the picker asks again.
  it('discards the whole value when the stored role is not a real UserRole', () => {
    localStorage.setItem(
      'biddaloy:activeTenant',
      JSON.stringify({ tenantId: 'tenant-1', role: 'HEADMASTER' }),
    );

    expect(getPersistedTenant()).toBeNull();
  });

  it('discards a stored object with a tenant but no role key at all', () => {
    localStorage.setItem('biddaloy:activeTenant', JSON.stringify({ tenantId: 'tenant-1' }));

    expect(getPersistedTenant()).toBeNull();
  });

  it('returns null for a stored object with no tenant id', () => {
    localStorage.setItem('biddaloy:activeTenant', JSON.stringify({ role: UserRole.ADMIN }));

    expect(getPersistedTenant()).toBeNull();
  });

  it('clears the persisted value', () => {
    persistTenant('tenant-1', UserRole.ADMIN);
    clearPersistedTenant();

    expect(getPersistedTenant()).toBeNull();
  });
});
