import { Permission, UserRole } from '@biddaloy/shared';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearAuthState, setActiveRole } from '../api/auth-state';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { hasPermission, useHasPermission } from './permissions';

describe('hasPermission', () => {
  it('is true for an ADMIN and SETTINGS_MANAGE', () => {
    expect(hasPermission(UserRole.ADMIN, Permission.SETTINGS_MANAGE)).toBe(true);
  });

  it('is true for a SUPER_ADMIN and any permission — they hold every one', () => {
    expect(hasPermission(UserRole.SUPER_ADMIN, Permission.SETTINGS_MANAGE)).toBe(true);
    expect(hasPermission(UserRole.SUPER_ADMIN, Permission.STUDENT_CREATE)).toBe(true);
  });

  it('is false for a role that does not hold the permission', () => {
    expect(hasPermission(UserRole.STUDENT, Permission.SETTINGS_MANAGE)).toBe(false);
  });

  it('fails closed for null or an unrecognized role, rather than throwing', () => {
    expect(hasPermission(null, Permission.SETTINGS_MANAGE)).toBe(false);
    expect(hasPermission('NOT_A_REAL_ROLE', Permission.SETTINGS_MANAGE)).toBe(false);
  });
});

describe('useHasPermission', () => {
  afterEach(() => {
    clearAuthState();
  });

  it('reads the active role from auth-state.ts', () => {
    setActiveRole(UserRole.ADMIN);
    const { result } = renderHookWithProviders(() => useHasPermission(Permission.SETTINGS_MANAGE));
    expect(result.current).toBe(true);
  });

  it('is false with no active role set', () => {
    const { result } = renderHookWithProviders(() => useHasPermission(Permission.SETTINGS_MANAGE));
    expect(result.current).toBe(false);
  });

  it('is reactive: a role change elsewhere re-renders a consumer without it re-invoking the hook itself', () => {
    setActiveRole(UserRole.STUDENT);
    const { result } = renderHookWithProviders(() => useHasPermission(Permission.SETTINGS_MANAGE));
    expect(result.current).toBe(false);

    act(() => {
      setActiveRole(UserRole.ADMIN);
    });

    expect(result.current).toBe(true);
  });
});
