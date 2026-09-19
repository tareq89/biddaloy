import { ApprovalScope } from '@biddaloy/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- interim types: #677 GET/POST/PATCH/DELETE /discount-rules ----
// Reconciliation seam: once #677 lands and `schema.d.ts` regenerates,
// replace these hand-typed shapes with the generated
// `components['schemas']` equivalent, same reconciliation note
// `payments.ts`'s `CartResult` block gives for #658.
export type DiscountKind = 'PERCENT' | 'FLAT';

export interface DiscountRule {
  id: string;
  student_id: string;
  kind: DiscountKind;
  value: number;
  fee_types: string[] | null;
  starts_on: string | null;
  ends_on: string | null;
  reason: string;
}

export interface CreateDiscountRuleInput {
  student_id: string;
  kind: DiscountKind;
  value: number;
  fee_types: string[] | null;
  starts_on: string | null;
  ends_on: string | null;
  reason: string;
}

export type UpdateDiscountRuleInput = Partial<Omit<CreateDiscountRuleInput, 'student_id'>> & {
  id: string;
};

export interface DeleteDiscountRuleInput {
  id: string;
  /** Kept on the input (rather than a second hook param) so
   * `useApprovedMutation`'s single `mutationFn(variables, options)`
   * signature has everything it needs to invalidate the right
   * student's list on success — see `onSuccess` below. */
  studentId: string;
}

const discountRuleKeys = createEntityKeys<{ studentId: string }, string>('discount-rules');

export function discountRulesQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: discountRuleKeys.list({ studentId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<DiscountRule[]>(`/students/${studentId}/discount-rules`, {
        signal,
      });
      return res.data;
    },
    enabled: Boolean(studentId),
    retry: shouldRetryQuery,
  });
}

/** [16.7.6] One student's discount rules — rendered in the Fees tab's
 * "Discounts" section. */
export function useDiscountRules(studentId: string) {
  return useQuery(discountRulesQueryOptions(studentId));
}

/**
 * [16.7.6] `POST /discount-rules`, approval-gated per D9/D8 — same shape
 * `payments.ts`'s `useCheckout`/`useReversePayment` use: `useApprovedMutation`
 * retries once with an `X-Approval-Token` on a `403 APPROVAL_REQUIRED`,
 * scoped here to `ApprovalScope.DISCOUNT_RULES_MANAGE`.
 */
export function useCreateDiscountRule(): ApprovedMutationResult<
  CreateDiscountRuleInput,
  DiscountRule
> {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async (input, options) =>
      (await apiClient.post<DiscountRule>('/discount-rules', input, options)).data,
    {
      approvalScope: ApprovalScope.DISCOUNT_RULES_MANAGE,
      retry: false,
      onSuccess: (rule) => {
        void queryClient.invalidateQueries({
          queryKey: discountRuleKeys.list({ studentId: rule.student_id }),
        });
      },
    },
  );
}

/** [16.7.6] `PATCH /discount-rules/:id`, same approval gating as create. */
export function useUpdateDiscountRule(
  studentId: string,
): ApprovedMutationResult<UpdateDiscountRuleInput, DiscountRule> {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async ({ id, ...body }, options) =>
      (await apiClient.patch<DiscountRule>(`/discount-rules/${id}`, body, options)).data,
    {
      approvalScope: ApprovalScope.DISCOUNT_RULES_MANAGE,
      retry: false,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: discountRuleKeys.list({ studentId }),
        });
      },
    },
  );
}

/** [16.7.6] `DELETE /discount-rules/:id`, same approval gating as create. */
export function useDeleteDiscountRule(): ApprovedMutationResult<DeleteDiscountRuleInput, void> {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async ({ id }, options) => {
      await apiClient.delete<void>(`/discount-rules/${id}`, options);
    },
    {
      approvalScope: ApprovalScope.DISCOUNT_RULES_MANAGE,
      retry: false,
      onSuccess: (_result, variables) => {
        void queryClient.invalidateQueries({
          queryKey: discountRuleKeys.list({ studentId: variables.studentId }),
        });
      },
    },
  );
}
