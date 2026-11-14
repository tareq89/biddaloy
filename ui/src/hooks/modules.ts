import {
  resolveModuleState,
  type ModuleKey,
  type ModuleState,
  type UserRole,
} from '@biddaloy/shared';

import { useActiveRole } from './auth-state';
import { useSchoolProfile } from './school-profile';

export type UseModuleState = ModuleState & { loading: boolean };

/**
 * Same resolver as the server (D51). A rendering aid only: the server stays
 * the source of truth (D27), so a route behind a hidden link still refuses.
 * Loading: `on`, so the shell does not flash; derived per render, never cached.
 * Error: resolved from empty input (default on). A failed profile fetch must
 * not lock a school out of its own screens; the server still enforces.
 */
export function useModuleState(key: ModuleKey): UseModuleState {
  return useModuleResolver()(key);
}

/**
 * Same rules as `useModuleState`, one hook call for many keys: the shell
 * filters dozens of nav items and palette rows, which a per-key hook cannot
 * do without hooks in a loop.
 */
export function useModuleResolver(): (key: ModuleKey) => UseModuleState {
  // The shell calls this on every page. throwOnError false: the app default rethrows a
  // suspended-school 403 into the route boundary, which would replace the whole shell (and its
  // school switcher) on a page that makes no other request, such as /dashboard.
  const { data, isPending } = useSchoolProfile({ throwOnError: false });
  const role = useActiveRole() as UserRole | null;
  return (key) => {
    if (isPending) return { on: true, source: 'default', loading: true };
    return {
      ...resolveModuleState(
        // `modules` can be missing on a stubbed or older profile; never crash the shell over it.
        { platform: data?.modules?.platform ?? null, school: data?.modules?.school ?? null, role },
        key,
      ),
      loading: false,
    };
  };
}

export const useModuleEnabled = (key: ModuleKey): boolean => useModuleState(key).on;
