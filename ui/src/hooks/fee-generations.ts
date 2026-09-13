import { useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { useApprovedMutation } from './approval';
import { feeDuesKeys } from './fee-dues';
import { createEntityKeys } from './query-keys';

/**
 * [16.3.7] — batch row-action mutations for the generation log page (16.3.4).
 *
 * **Integration note (append-merge):** this file is created standalone by
 * this ticket. #654 (16.3.4) creates the *same* file path with
 * `useFeeGenerations`/`useFeeGeneration`/`useFeeGenerationBills` — the
 * orchestrator appends this ticket's four hooks onto that file at
 * integration. `feeGenerationsKeys` below is this ticket's own key
 * factory for invalidation; if #654 already defines one under the same
 * name, the merge keeps a single definition (they're structurally
 * identical — both `createEntityKeys('fee-generations')`).
 *
 * All four hooks wrap their mutation function with `useApprovedMutation`
 * (see that file's own doc comment) so the step-up approval modal only
 * appears when the server actually answers `403 APPROVAL_REQUIRED` — per
 * #651's plan, that happens whenever a bill in scope already has money
 * against it (`paid_amount > 0` or an allocation). Callers render
 * `.modal` once, anywhere, same as every other `useApprovedMutation`
 * caller.
 */
export const feeGenerationsKeys = createEntityKeys('fee-generations');

/** #651's `PatchFeeGenerationDto` — all fields optional, only sent fields
 * change. */
export interface PatchFeeGenerationInput {
  period_start?: string;
  period_type?: 'MONTH' | 'WEEK';
  due_date?: string;
}

/** #651: "re-validate uniqueness (conflict -> 409 listing the students)".
 * Read this off `ApiError.details` when `statusCode === 409` — see
 * `-edit-batch-dialog.tsx` for the intended usage. */
export interface PatchFeeGenerationConflict {
  students: Array<{ id: string; full_name: string }>;
}

export interface RemoveUncollectedResult {
  removed_count: number;
}

function invalidateGeneration(
  queryClient: ReturnType<typeof useQueryClient>,
  generationId: string,
) {
  // The batch itself, its bills, and the dues queue those bills feed all
  // go stale together — same "invalidate the whole branch, not one
  // variant" reasoning `fee-dues.ts`/`payments.ts` give for their own
  // mutations.
  void queryClient.invalidateQueries({ queryKey: feeGenerationsKeys.detail(generationId) });
  void queryClient.invalidateQueries({ queryKey: feeGenerationsKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: feeDuesKeys.lists() });
}

/** `PATCH /fees/generations/:id` — change period/period type/due date for
 * the batch and every one of its bills. */
export function usePatchFeeGeneration(generationId: string) {
  const queryClient = useQueryClient();
  return useApprovedMutation<PatchFeeGenerationInput, void>(
    async (input, options) => {
      await apiClient.patch<void>(`/fees/generations/${generationId}`, input, options);
    },
    {
      approvalScope: 'fees.edit_paid',
      onSuccess: () => invalidateGeneration(queryClient, generationId),
    },
  );
}

/** `DELETE /fees/generations/:id` — soft-delete the batch and all its
 * bills. */
export function useDeleteFeeGeneration() {
  const queryClient = useQueryClient();
  return useApprovedMutation<string, void>(
    async (generationId, options) => {
      await apiClient.delete<void>(`/fees/generations/${generationId}`, options);
    },
    {
      approvalScope: 'fees.edit_paid',
      onSuccess: (_result, generationId) => invalidateGeneration(queryClient, generationId),
    },
  );
}

export interface RemoveBatchStudentInput {
  generationId: string;
  studentId: string;
}

/** `DELETE /fees/generations/:id/students/:studentId` — soft-delete just
 * that student's bills from the batch. */
export function useRemoveBatchStudent() {
  const queryClient = useQueryClient();
  return useApprovedMutation<RemoveBatchStudentInput, void>(
    async ({ generationId, studentId }, options) => {
      await apiClient.delete<void>(
        `/fees/generations/${generationId}/students/${studentId}`,
        options,
      );
    },
    {
      approvalScope: 'fees.edit_paid',
      onSuccess: (_result, { generationId }) => invalidateGeneration(queryClient, generationId),
    },
  );
}

/** `POST /fees/generations/:id/remove-uncollected` — soft-delete only
 * bills with no money against them. #651: "no approval" — this still goes
 * through `useApprovedMutation` for a consistent call shape, but the
 * server never answers `APPROVAL_REQUIRED` for this route, so the modal
 * never opens in practice. */
export function useRemoveUncollected() {
  const queryClient = useQueryClient();
  return useApprovedMutation<string, RemoveUncollectedResult>(
    async (generationId, options) => {
      const res = await apiClient.post<RemoveUncollectedResult>(
        `/fees/generations/${generationId}/remove-uncollected`,
        undefined,
        options,
      );
      return res.data;
    },
    {
      approvalScope: 'fees.edit_paid',
      onSuccess: (_result, generationId) => invalidateGeneration(queryClient, generationId),
    },
  );
}
