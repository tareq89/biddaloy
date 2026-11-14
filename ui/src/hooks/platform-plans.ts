import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { useIdempotencyKey } from './idempotency-key';
import { platformBillingKeys } from './platform-billing';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { schoolsKeys } from './school-settings';

type S = components['schemas'];
export type PlatformPlan = S['PlanDto'];
export type CreatePlanInput = S['CreatePlanDto'];
export type UpdatePlanInput = S['UpdatePlanDto'];
export type AssignPlanInput = S['AssignPlanDto'];
export type PlanPrice = S['PlanPriceDto'];

export const platformPlanKeys = createEntityKeys('platform-plans');

/** `GET /platform/plans` (all plans, at most 100; the server has no cursor here). */
export function usePlatformPlans() {
  return useQuery({
    queryKey: platformPlanKeys.lists(),
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformPlan[]>({ url: '/platform/plans', params: { limit: 100 }, signal }),
    retry: shouldRetryQuery,
  });
}

function useInvalidatePlans() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: platformPlanKeys.all });
    void queryClient.invalidateQueries({ queryKey: platformBillingKeys.all });
    void queryClient.invalidateQueries({ queryKey: schoolsKeys.lists() });
  };
}

/** `POST /platform/plans`. Step-up scope `platform.plan`. */
export function useCreatePlan() {
  const invalidate = useInvalidatePlans();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    (input: CreatePlanInput, { headers }) =>
      cockpitRequest<PlatformPlan>({
        method: 'POST',
        url: '/platform/plans',
        data: input,
        headers: { ...headers, 'Idempotency-Key': keyFor(input) },
      }),
    {
      approvalScope: 'platform.plan',
      onSuccess: () => {
        rotate();
        invalidate();
      },
    },
  );
}

/** `PATCH /platform/plans/:id`: edit, or deactivate with `{ active: false }`. */
export function useUpdatePlan() {
  const invalidate = useInvalidatePlans();
  return useApprovedMutation(
    ({ id, ...data }: UpdatePlanInput & { id: string }, { headers }) =>
      cockpitRequest<PlatformPlan>({
        method: 'PATCH',
        url: `/platform/plans/${id}`,
        data,
        headers,
      }),
    { approvalScope: 'platform.plan', onSuccess: invalidate },
  );
}

/** `POST /platform/plans/:id/make-default`. */
export function useMakePlanDefault() {
  const invalidate = useInvalidatePlans();
  return useApprovedMutation(
    ({ id }: { id: string }, { headers }) =>
      cockpitRequest<PlatformPlan>({
        method: 'POST',
        url: `/platform/plans/${id}/make-default`,
        headers,
      }),
    { approvalScope: 'platform.plan', onSuccess: invalidate },
  );
}

/** `POST /platform/billing/schools/:id/plan`: move a school to a plan (prices its next order). */
export function useChangeSchoolPlan(schoolId: string) {
  const invalidate = useInvalidatePlans();
  return useApprovedMutation(
    (input: AssignPlanInput, { headers }) =>
      cockpitRequest<PlanPrice>({
        method: 'POST',
        url: `/platform/billing/schools/${schoolId}/plan`,
        data: input,
        headers,
      }),
    { approvalScope: 'platform.plan', onSuccess: invalidate },
  );
}
