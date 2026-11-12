import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// The server's own DTOs (generated), not the hand-written ones in `@biddaloy/shared`,
// which name some fields differently (`name` vs `fullName`, `createdAt` vs `at`).
export type PlatformOwner = components['schemas']['PlatformOwnerDto'];
export type PlatformHistoryRow = components['schemas']['PlatformHistoryRowDto'];
export type PlatformHistoryPage = components['schemas']['PlatformHistoryPageDto'];

export const platformOwnerKeys = createEntityKeys('platform-owners');
export const platformHistoryKeys = createEntityKeys('platform-history');

export function usePlatformOwners() {
  return useQuery({
    queryKey: platformOwnerKeys.lists(),
    queryFn: ({ signal }) => cockpitRequest<PlatformOwner[]>({ url: '/platform/owners', signal }),
    retry: shouldRetryQuery,
  });
}

/** Cursor-paged: `fetchNextPage` follows `nextCursor` until it is null. */
export function usePlatformHistory(limit = 50) {
  return useInfiniteQuery({
    queryKey: platformHistoryKeys.list({ limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      cockpitRequest<PlatformHistoryPage>({
        url: '/platform/owners/history',
        params: { cursor: pageParam, limit },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: shouldRetryQuery,
  });
}

function useOwnerToggle(action: 'lock' | 'unlock') {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    (userId: string, { headers }) =>
      cockpitRequest({ method: 'POST', url: `/platform/owners/${userId}/${action}`, headers }),
    {
      approvalScope: `platform.owner_${action}`,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: platformOwnerKeys.all });
        void queryClient.invalidateQueries({ queryKey: platformHistoryKeys.all });
      },
    },
  );
}

/** Asks for an authenticator code first (step-up). Locking yourself or the last owner is a 4xx. */
export const useLockOwner = () => useOwnerToggle('lock');
export const useUnlockOwner = () => useOwnerToggle('unlock');
