import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { useIdempotencyKey } from './idempotency-key';
import { getApprovalRequestId } from './platform-approvals';
import { MONEY_PAGE_SIZE } from './platform-money-sms';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type CreateCouponInput = S['CreateCouponDto'];
export type CreateFreeCouponInput = S['CreateFreeCouponDto'];
export type UpdateCouponInput = S['UpdateCouponDto'];

/** Mirrors `CouponItem` in `server/.../coupons/coupons.service.ts` (the schema leaves it untyped). */
export interface PlatformCoupon {
  id: string;
  code: string;
  discount_kind: 'PERCENT' | 'FIXED';
  percent: number | null;
  fixed_paisa: number | null;
  max_months: number | null;
  /** Whole paisa, as a string. */
  max_discount_paisa: string | null;
  min_order_paisa: string | null;
  scope: 'ALL' | 'SCHOOLS';
  max_uses: number | null;
  uses_count: number;
  per_school_max: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
  created_at: string;
}
export interface CouponPage {
  items: PlatformCoupon[];
  nextCursor: string | null;
}
export interface CouponUsage {
  uses: number;
  totalDiscountPaisa: string;
  schools: {
    items: { schoolId: string; schoolName: string; uses: number; discountPaisa: string }[];
    nextCursor: string | null;
  };
}

/** What a coupon create came to (the 100 percent route can wait on the other owner). */
export type CouponCreateResult =
  | { kind: 'created'; coupon: PlatformCoupon }
  | { kind: 'waiting'; requestId: string }
  | { kind: 'needs-second-owner' };

export const platformCouponKeys = createEntityKeys<{ cursor?: string | undefined }>(
  'platform-coupons',
);
export const platformCouponUsageKeys = createEntityKeys<{
  id: string;
  cursor?: string | undefined;
}>('platform-coupon-usage');

/** `GET /platform/coupons` (newest first, keyset). */
export function usePlatformCoupons(cursor?: string) {
  return useQuery({
    queryKey: platformCouponKeys.list({ cursor }),
    queryFn: ({ signal }) =>
      cockpitRequest<CouponPage>({
        url: '/platform/coupons',
        params: { limit: MONEY_PAGE_SIZE, cursor },
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/** `GET /platform/coupons/:id/usage`. */
export function useCouponUsage(id: string | undefined, cursor?: string) {
  return useQuery({
    queryKey: platformCouponUsageKeys.list({ id: id ?? '', cursor }),
    queryFn: ({ signal }) =>
      cockpitRequest<CouponUsage>({
        url: `/platform/coupons/${id}/usage`,
        params: { limit: MONEY_PAGE_SIZE, cursor },
        signal,
      }),
    enabled: !!id,
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

function useInvalidateCoupons() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: platformCouponKeys.all });
    void queryClient.invalidateQueries({ queryKey: platformCouponUsageKeys.all });
  };
}

/** `POST /platform/coupons` (percent 1-99 or fixed). Step-up `platform.coupon`; `Idempotency-Key`. */
export function useCreateCoupon() {
  const invalidate = useInvalidateCoupons();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    (input: CreateCouponInput, { headers }) =>
      cockpitRequest<PlatformCoupon>({
        method: 'POST',
        url: '/platform/coupons',
        data: input,
        headers: { ...headers, 'Idempotency-Key': keyFor(input) },
      }),
    {
      approvalScope: 'platform.coupon',
      onSuccess: () => {
        rotate();
        invalidate();
      },
    },
  );
}

/**
 * `POST /platform/coupons/free` (100 percent). Step-up `platform.coupon_free` plus the other
 * owner. The result is a value, not a throw, for the two outcomes the screen shows as states:
 * `waiting` (403 `APPROVAL_REQUESTED`; once they approve, call again with `approvalId`) and
 * `needs-second-owner` (409/422). Every other failure still throws.
 * ponytail: today's server never answers 409/422 for a missing second owner (with one active
 * owner the guard lets the call through); kept because the ticket contract names it.
 */
export function useCreateFreeCoupon() {
  const invalidate = useInvalidateCoupons();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    async (
      { approvalId, ...input }: CreateFreeCouponInput & { approvalId?: string },
      { headers },
    ): Promise<CouponCreateResult> => {
      try {
        const coupon = await cockpitRequest<PlatformCoupon>({
          method: 'POST',
          url: '/platform/coupons/free',
          data: input,
          headers: {
            ...headers,
            'Idempotency-Key': keyFor(input),
            ...(approvalId ? { 'X-Platform-Approval': approvalId } : {}),
          },
        });
        return { kind: 'created', coupon };
      } catch (error) {
        const requestId = getApprovalRequestId(error);
        if (requestId) return { kind: 'waiting', requestId };
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (status === 409 || status === 422) return { kind: 'needs-second-owner' };
        throw error;
      }
    },
    {
      approvalScope: 'platform.coupon_free',
      onSuccess: (result) => {
        if (result.kind !== 'created') return;
        rotate();
        invalidate();
      },
    },
  );
}

/** `PATCH /platform/coupons/:id`: disable (`active: false`), extend, raise the cap, set schools. */
export function useUpdateCoupon() {
  const invalidate = useInvalidateCoupons();
  return useApprovedMutation(
    ({ id, ...data }: UpdateCouponInput & { id: string }, { headers }) =>
      cockpitRequest<PlatformCoupon>({
        method: 'PATCH',
        url: `/platform/coupons/${id}`,
        data,
        headers,
      }),
    { approvalScope: 'platform.coupon', onSuccess: invalidate },
  );
}
