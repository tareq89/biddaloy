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
  const { data, isPending } = useSchoolProfile();
  const role = useActiveRole() as UserRole | null;
  if (isPending) return { on: true, source: 'default', loading: true };
  return {
    ...resolveModuleState(
      { platform: data?.modules.platform ?? null, school: data?.modules.school ?? null, role },
      key,
    ),
    loading: false,
  };
}

export const useModuleEnabled = (key: ModuleKey): boolean => useModuleState(key).on;
