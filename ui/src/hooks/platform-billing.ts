import type {
  PlatformSchoolBilling,
  PlatformSchoolBillingDetail,
  PlatformSchoolBillingPage,
  SchoolBillingFilter,
} from '@biddaloy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { useIdempotencyKey } from './idempotency-key';
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

/** `POST /platform/schools/:id/revive` — a school paused for having no students. */
export function useReviveSchool(schoolId: string) {
  const invalidate = useInvalidateBilling(schoolId);
  return useMutation({
    mutationFn: async (input: { reason: string }) =>
      (await apiClient.post<unknown>(`/platform/schools/${schoolId}/revive`, input)).data,
    retry: false,
    onSuccess: invalidate,
  });
}

/** A school's SMS package order as the detail answers it (mirrors the server's `BundleOrderRow`). */
export interface PlatformBundleOrder {
  id: string;
  status: string;
  bundle_name?: string;
  sms_count: number;
  amount_paisa?: number;
  receipt_number: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  units_bought: number;
  units_used: number;
  /** ACTIVE with no unit used yet. */
  refundable: boolean;
}
/** The detail with its `bundle_orders` typed (the OpenAPI schema leaves them loose). */
export type PlatformSchoolBillingDetailWithBundles = Omit<
  PlatformSchoolBillingDetail,
  'bundle_orders'
> & { bundle_orders: PlatformBundleOrder[] };

export type RefundResult = components['schemas']['RefundResultDto'];
export type VatSetting = components['schemas']['VatSettingDto'];
export type UpdateVatInput = components['schemas']['UpdateVatDto'];
export const platformVatKeys = createEntityKeys('platform-money-vat');

/**
 * `POST /platform/billing/orders/:id/refund` or `.../sms-bundle-orders/:id/refund`. Step-up
 * `platform.refund`; one `Idempotency-Key` per dialog open (the same body re-sends the same key).
 * Money goes back through the bKash panel; the answer's `note` says so.
 */
export function useRefundOrder(schoolId: string, kind: 'seat' | 'package') {
  const invalidate = useInvalidateBilling(schoolId);
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    ({ orderId, reason }: { orderId: string; reason: string }, { headers }) =>
      cockpitRequest<RefundResult>({
        method: 'POST',
        url:
          kind === 'seat'
            ? `/platform/billing/orders/${orderId}/refund`
            : `/platform/billing/sms-bundle-orders/${orderId}/refund`,
        data: { reason },
        headers: { ...headers, 'Idempotency-Key': keyFor({ orderId, reason, kind }) },
      }),
    {
      approvalScope: 'platform.refund',
      onSuccess: () => {
        rotate();
        invalidate();
      },
    },
  );
}

/** `GET /platform/money/vat`. */
export function usePlatformVat() {
  return useQuery({
    queryKey: platformVatKeys.all,
    queryFn: ({ signal }) => cockpitRequest<VatSetting>({ url: '/platform/money/vat', signal }),
    retry: shouldRetryQuery,
  });
}

/** `PUT /platform/money/vat`. Step-up `platform.vat`. */
export function useUpdateVat() {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    (input: UpdateVatInput, { headers }) =>
      cockpitRequest<VatSetting>({
        method: 'PUT',
        url: '/platform/money/vat',
        data: input,
        headers,
      }),
    {
      approvalScope: 'platform.vat',
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: platformVatKeys.all }),
    },
  );
}
