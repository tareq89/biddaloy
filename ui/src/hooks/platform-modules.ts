import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type PlatformModules = S['PlatformModulesResponseDto']['modules'];
export type SchoolModuleStates = S['SchoolModulesResponseDto']['modules'];
export type ModuleLock = 'on' | 'off' | null;

export const platformModulesKeys = createEntityKeys('platform-modules');
export const schoolPlatformModulesKeys = createEntityKeys('platform-school-modules');

const SCOPE = { approvalScope: 'platform.school_control', retry: false } as const;

/** Global module map: only `false` keys are meaningful, an absent key is on. */
export function usePlatformModules() {
  return useQuery({
    queryKey: platformModulesKeys.all,
    queryFn: ({ signal }) =>
      cockpitRequest<S['PlatformModulesResponseDto']>({ url: '/platform/modules', signal }),
    select: (data) => data.modules,
    retry: shouldRetryQuery,
  });
}

/** Replaces the WHOLE global map. Step-up code. */
export function useSetPlatformModules() {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    ({ modules }: { modules: PlatformModules }, { headers }) =>
      cockpitRequest<S['PlatformModulesResponseDto']>({
        method: 'PUT',
        url: '/platform/modules',
        data: { modules },
        headers,
      }),
    {
      approvalScope: SCOPE.approvalScope,
      retry: false,
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: platformModulesKeys.all }),
    },
  );
}

/** One school's own choices and platform locks. */
export function useSchoolPlatformModules(schoolId: string | undefined) {
  return useQuery({
    queryKey: schoolPlatformModulesKeys.detail(schoolId ?? ''),
    queryFn: ({ signal }) =>
      cockpitRequest<S['SchoolModulesResponseDto']>({
        url: `/platform/schools/${schoolId}/modules`,
        signal,
      }),
    select: (data) => data.modules,
    enabled: !!schoolId,
    retry: shouldRetryQuery,
  });
}

/** Lock one module of one school on or off, or clear the lock (`null`). Step-up code. */
export function useSetSchoolModuleLock(schoolId: string) {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    ({ key, lock }: { key: string; lock: ModuleLock }, { headers }) =>
      cockpitRequest<unknown>({
        method: 'PUT',
        url: `/platform/schools/${schoolId}/modules/${key}/lock`,
        data: { lock },
        headers,
      }),
    {
      approvalScope: SCOPE.approvalScope,
      retry: false,
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: schoolPlatformModulesKeys.all }),
    },
  );
}
