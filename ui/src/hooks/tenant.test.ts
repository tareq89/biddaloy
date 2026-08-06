import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import { clearAuthState, getActiveRole, getActiveTenant } from '../api/auth-state';

import { switchActiveTenant } from './tenant';

afterEach(() => clearAuthState());

describe('switchActiveTenant', () => {
  it('updates the active tenant (and role, when given) alongside clearing the cache', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['probe'], { ok: true });

    switchActiveTenant(queryClient, 'tenant-2', 'TEACHER');

    expect(getActiveTenant()).toBe('tenant-2');
    expect(getActiveRole()).toBe('TEACHER');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('leaves the role untouched when none is given', () => {
    const queryClient = new QueryClient();

    switchActiveTenant(queryClient, 'tenant-3');

    expect(getActiveTenant()).toBe('tenant-3');
    expect(getActiveRole()).toBeNull();
  });
});
