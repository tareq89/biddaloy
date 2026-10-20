import type {
  PlatformSchoolBilling,
  PlatformSchoolBillingDetail,
  PlatformSchoolBillingPage,
  SchoolBillingFilter,
} from '@biddaloy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { schoolsKeys } from './school-settings';

export type {
  PlatformSchoolBilling,
  PlatformSchoolBillingDetail,
  PlatformSchoolBillingPage,
  SchoolBillingFilter,
};

export const platformBillingKeys = createEntityKeys<{
  search?: string;
  filter?: SchoolBillingFilter;
  page?: number;
}>('platform-billing');

/** Rows per page (Rule 5: the server caps `limit` at 100). */
export const PLATFORM_BILLING_PAGE_SIZE = 20;

/** `GET /platform/billing/schools` — platform SUPER_ADMIN only. */
export function usePlatformSchoolBilling(
  params: { search?: string; filter?: SchoolBillingFilter; page?: number } = {},
) {
  return useQuery({
    queryKey: platformBillingKeys.list(params),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PlatformSchoolBillingPage>('/platform/billing/schools', {
          params: {
            search: params.search,
            filter: params.filter,
            limit: PLATFORM_BILLING_PAGE_SIZE,
            offset: ((params.page ?? 1) - 1) * PLATFORM_BILLING_PAGE_SIZE,
          },
          signal,
        })
      ).data,
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/** `GET /platform/billing/schools/:id` — entitlement plus the school's orders. */
export function usePlatformSchoolBillingDetail(schoolId: string | undefined) {
  return useQuery({
    queryKey: platformBillingKeys.detail(schoolId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PlatformSchoolBillingDetail>(`/platform/billing/schools/${schoolId}`, {
          signal,
        })
      ).data,
    enabled: !!schoolId,
    retry: shouldRetryQuery,
  });
}

export interface OfflinePaymentInput {
  method: 'OFFLINE_BANK' | 'OFFLINE_CASH';
  reference: string;
  /** One per dialog open; a retry reuses it. */
  idempotency_key: string;
}

export interface GrantSeatsInput {
  seats: number;
  months: number;
  reason: string;
  idempotency_key: string;
}

function useInvalidateBilling(schoolId: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: platformBillingKeys.all });
    void queryClient.invalidateQueries({ queryKey: schoolsKeys.lists() });
    if (schoolId) void queryClient.invalidateQueries({ queryKey: schoolsKeys.detail(schoolId) });
  };
}

/** `POST /platform/billing/orders/:id/offline-payment`. */
export function useRecordOfflinePayment(schoolId: string) {
  const invalidate = useInvalidateBilling(schoolId);
  return useMutation({
    mutationFn: async ({ orderId, ...body }: OfflinePaymentInput & { orderId: string }) =>
      (
        await apiClient.post<{ applied: boolean }>(
          `/platform/billing/orders/${orderId}/offline-payment`,
          body,
        )
      ).data,
    retry: false,
    onSuccess: invalidate,
  });
}

/** `POST /platform/billing/schools/:id/grant`. */
export function useGrantSeats(schoolId: string) {
  const invalidate = useInvalidateBilling(schoolId);
  return useMutation({
    mutationFn: async (input: GrantSeatsInput) =>
      (
        await apiClient.post<PlatformSchoolBillingDetail>(
          `/platform/billing/schools/${schoolId}/grant`,
          input,
        )
      ).data,
    retry: false,
    onSuccess: invalidate,
  });
}

/** `POST /schools/:id/revive` — a school paused for having no students. */
export function useReviveSchool(schoolId: string) {
  const invalidate = useInvalidateBilling(schoolId);
  return useMutation({
    mutationFn: async (input: { reason: string }) =>
      (await apiClient.post<unknown>(`/schools/${schoolId}/revive`, input)).data,
    retry: false,
    onSuccess: invalidate,
  });
}
