import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { myClassKeys } from './my-class';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- Types (`/attendance/arrival-subscriptions` + `/portal/arrival-subscriptions`, [84.2.x]) ----

type Schemas = components['schemas'];
export type StaffArrivalSubscription = Schemas['StaffArrivalSubscriptionDto'];
export type ArrivalSubscription = Schemas['ArrivalSubscriptionResponseDto'];
export type CreateArrivalSubscriptionInput = Schemas['CreateArrivalSubscriptionDto'];
export type UpdateArrivalSubscriptionInput = Schemas['UpdateArrivalSubscriptionDto'];
export type ArrivalLock = Schemas['LockArrivalSubscriptionDto']['lock'];
export type MyArrivalSubscriptions = Schemas['MyArrivalSubscriptionsDto'];
export type MyArrivalChild = Schemas['MyArrivalChildDto'];
export type UpsertMyArrivalSubscriptionInput = Schemas['UpsertMyArrivalSubscriptionDto'];

export interface ArrivalSubscriptionFilters {
  sectionId?: string;
  status?: StaffArrivalSubscription['status'];
}

/** The server's page cap (`take ≤ 100`). */
const PAGE = 100;

export const arrivalSubscriptionKeys = {
  ...createEntityKeys<ArrivalSubscriptionFilters, string>('arrival-subscriptions'),
  mine: () => ['arrival-subscriptions', 'mine'] as const,
};

// ---- Queries ----

/**
 * Staff list; a TEACHER only ever gets their homeroom sections (server-side). Reads every page,
 * so a section with more rows than one page still shows each waiting request (the My class
 * badge counts them all).
 */
export function useArrivalSubscriptions(
  filters: ArrivalSubscriptionFilters = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: arrivalSubscriptionKeys.list(filters),
    queryFn: async () => {
      // ponytail: one call per 100 rows; a section holds a few dozen at most.
      const all: StaffArrivalSubscription[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const res = await apiClient.get<StaffArrivalSubscription[]>(
          '/attendance/arrival-subscriptions',
          { params: { ...filters, limit: PAGE, offset } },
        );
        all.push(...res.data);
        if (res.data.length < PAGE) return all;
      }
    },
    enabled: options.enabled ?? true,
    retry: shouldRetryQuery,
  });
}

/** Portal: the guardian's children with their subscription, plus the school switches. */
export function usePortalArrivalSubscriptions() {
  return useQuery({
    queryKey: arrivalSubscriptionKeys.mine(),
    queryFn: async () => {
      const res = await apiClient.get<MyArrivalSubscriptions>('/portal/arrival-subscriptions');
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

// ---- Mutations (Rule 25: `retry: false`, one `Idempotency-Key` per attempt) ----

function useInvalidateArrival() {
  const qc = useQueryClient();
  // My class shows `arrival_request_count`, so it goes stale on a confirm or decline too.
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: arrivalSubscriptionKeys.all }),
      qc.invalidateQueries({ queryKey: myClassKeys.all }),
    ]);
}

export function useCreateArrivalSubscription() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateArrival();
  return useMutation({
    mutationFn: async (input: CreateArrivalSubscriptionInput) => {
      const res = await apiClient.post<ArrivalSubscription>(
        '/attendance/arrival-subscriptions',
        input,
        { headers: { 'Idempotency-Key': keyFor(input) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

/** Confirm / decline / switch off / change mode (status, mode). */
export function usePatchArrivalSubscription() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateArrival();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateArrivalSubscriptionInput }) => {
      const res = await apiClient.patch<ArrivalSubscription>(
        `/attendance/arrival-subscriptions/${id}`,
        input,
        { headers: { 'Idempotency-Key': keyFor({ id, input }) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

/** Principal-only: ALWAYS / NEVER / NONE. */
export function useLockArrivalSubscription() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateArrival();
  return useMutation({
    mutationFn: async ({ id, lock }: { id: string; lock: ArrivalLock }) => {
      const res = await apiClient.patch<ArrivalSubscription>(
        `/attendance/arrival-subscriptions/${id}/lock`,
        { lock },
        { headers: { 'Idempotency-Key': keyFor({ id, lock }) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}

/** Portal: request (want=true) or switch off (want=false) for one child. */
export function usePutPortalArrivalSubscription() {
  const { keyFor, rotate } = useIdempotencyKey();
  const invalidate = useInvalidateArrival();
  return useMutation({
    mutationFn: async ({
      studentId,
      input,
    }: {
      studentId: string;
      input: UpsertMyArrivalSubscriptionInput;
    }) => {
      // null = switched off a subscription that never existed.
      const res = await apiClient.put<ArrivalSubscription | null>(
        `/portal/arrival-subscriptions/${studentId}`,
        input,
        { headers: { 'Idempotency-Key': keyFor({ studentId, input }) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      return invalidate();
    },
    retry: false,
  });
}
