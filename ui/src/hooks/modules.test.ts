// @vitest-environment jsdom
import { ModuleKey, UserRole } from '@biddaloy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), role: String('TEACHER') }));
vi.mock('../api/client', () => ({ apiClient: { get: h.get } }));
vi.mock('./auth-state', () => ({ useActiveRole: () => h.role }));

import { useModuleEnabled, useModuleResolver, useModuleState } from './modules';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}
const profile = (school: object, platform: object = {}) => ({
  data: { modules: { platform, school }, labels: {} },
});

describe('useModuleState', () => {
  beforeEach(() => {
    h.get.mockReset();
    h.role = UserRole.TEACHER;
  });

  it('is on + loading while the profile loads', () => {
    h.get.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useModuleState(ModuleKey.homework), {
      wrapper: wrapper(),
    });
    expect(result.current).toMatchObject({ on: true, loading: true });
  });

  it('TEACHER with homework role-off -> off', async () => {
    h.get.mockResolvedValue(profile({ homework: { offForRoles: [UserRole.TEACHER] } }));
    const { result } = renderHook(() => useModuleState(ModuleKey.homework), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ on: false, source: 'role' });
  });

  it('ADMIN is never role-off', async () => {
    h.role = UserRole.ADMIN;
    h.get.mockResolvedValue(profile({ homework: { offForRoles: [UserRole.TEACHER] } }));
    const { result } = renderHook(() => useModuleEnabled(ModuleKey.homework), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('dependency off turns the dependant off', async () => {
    h.get.mockResolvedValue(profile({ fees: { on: false } }));
    const { result } = renderHook(() => useModuleState(ModuleKey.fines), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ on: false, source: 'dependency', dependsOn: 'fees' });
  });

  it('profile error resolves from empty input (on); server stays the authority', async () => {
    h.get.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useModuleState(ModuleKey.homework), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ on: true, source: 'default' });
  });

  it('useModuleResolver answers for many keys from one profile fetch', async () => {
    h.get.mockResolvedValue(profile({ fines: { on: false } }));
    const { result } = renderHook(() => useModuleResolver(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current(ModuleKey.fines).loading).toBe(false));
    expect(result.current(ModuleKey.fines).on).toBe(false);
    expect(result.current(ModuleKey.homework).on).toBe(true);
    expect(h.get).toHaveBeenCalledTimes(1);
  });
});
