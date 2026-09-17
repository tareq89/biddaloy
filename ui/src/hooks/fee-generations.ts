import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { useApprovedMutation } from './approval';
import { feeDuesKeys } from './fee-dues';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/** `FeeGenerationsController_findAll_v1`'s 200 body is untyped in
 * `schema.d.ts` (`content?: never` — same gap `fee-dues.ts`'s own comment
 * documents for `FeeController.getDues`), so this is hand-typed against
 * `server/src/modules/fees/dto/fee-generations.dto.ts`'s
 * `FeeGenerationListItemDto`, the shape `FeeGenerationsService.findAll`
 * actually returns. */
export interface FeeGenerationStructureSnapshot {
  id: string;
  name: string;
  fee_type: string;
  amount: number;
}

/** One row of `GET /fees/generations` — a generation batch with its
 * billed/collected totals and derived collection status, matching
 * `FeeGenerationListItemDto` byte for byte. */
export interface FeeGeneration {
  id: string;
  academic_year_id: string;
  period_start: string;
  period_type: 'MONTH' | 'WEEK';
  due_date: string;
  source: 'MANUAL' | 'SCHEDULE';
  duplicate_strategy: 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY';
  notify_families: boolean;
  student_count: number;
  generated_count: number;
  skipped_count: number;
  removed_count: number;
  created_at: string;
  billed_amount: number;
  collected_amount: number;
  collection_status: 'NONE' | 'PARTIAL' | 'FULL';
  generated_by: { id: string; full_name: string } | null;
  /** The fee structures this batch charged, snapshotted at generation
   * time — `batch-table.tsx` renders these as fee chips. */
  structures: FeeGenerationStructureSnapshot[];
}

export interface PaginatedFeeGenerations {
  data: FeeGeneration[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** The full filter set `GET /fees/generations` accepts —
 * `QueryFeeGenerationsDto`. */
export interface FeeGenerationsFilters {
  period_from?: string;
  period_to?: string;
  fee_type?: string;
  source?: 'MANUAL' | 'SCHEDULE';
  generated_by_user_id?: string;
  recurring_schedule_id?: string;
  collection_status?: 'NONE' | 'PARTIAL' | 'FULL';
  page?: number;
  limit?: number;
}

export const feeGenerationsKeys = createEntityKeys<FeeGenerationsFilters>('fee-generations');

export function feeGenerationsQueryOptions(filters: FeeGenerationsFilters = {}) {
  return queryOptions({
    queryKey: feeGenerationsKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedFeeGenerations>('/fees/generations', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    // Same reasoning `fee-dues.ts`'s `feeDuesQueryOptions` gives: keeps the
    // previous page's rows (and `isFetching` true) on screen instead of the
    // table collapsing during a filter/page change.
    placeholderData: keepPreviousData,
  });
}

export function useFeeGenerations(filters: FeeGenerationsFilters = {}) {
  return useQuery(feeGenerationsQueryOptions(filters));
}

export function feeGenerationQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: id ? feeGenerationsKeys.detail(id) : [...feeGenerationsKeys.details(), 'disabled'],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<FeeGeneration>(`/fees/generations/${id}`, { signal });
      return res.data;
    },
    enabled: Boolean(id),
    retry: shouldRetryQuery,
  });
}

export function useFeeGeneration(id: string | undefined) {
  return useQuery(feeGenerationQueryOptions(id));
}

/** One bill this batch created — `FeeGenerationBillItemDto`. `discount`
 * isn't part of that DTO (`FeeGenerationsService.findBills`'s `qb` never
 * selects a discount column off `student_fees`), unlike the issue body's
 * "student, class, fee, amount, discount, paid, status" column list —
 * flagged in the PR body as an endpoint-shape gap. */
export interface FeeGenerationBill {
  id: string;
  student_id: string;
  student_full_name: string;
  student_registration_number: string | null;
  class_name: string | null;
  fee_name: string;
  amount: number;
  paid_amount: number;
  status: string;
  /** e.g. `"3/2026"` — `FeeGenerationBillItemDto.occurrence`'s own
   * `${month}/${year}` shape, not a display string. Rendered as `"(2)"`
   * per the issue's own drill-down spec — see `batch-bills-drawer.tsx`. */
  occurrence: string;
}

export interface PaginatedFeeGenerationBills {
  data: FeeGenerationBill[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeeGenerationBillsFilters {
  page?: number;
  limit?: number;
}

const feeGenerationBillsKeys = createEntityKeys<FeeGenerationBillsFilters & { batchId: string }>(
  'fee-generation-bills',
);

export function feeGenerationBillsQueryOptions(
  batchId: string | undefined,
  filters: FeeGenerationBillsFilters = {},
) {
  return queryOptions({
    queryKey: batchId
      ? feeGenerationBillsKeys.list({ ...filters, batchId })
      : [...feeGenerationBillsKeys.lists(), 'disabled'],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedFeeGenerationBills>(
        `/fees/generations/${batchId}/bills`,
        { params: filters, signal },
      );
      return res.data;
    },
    enabled: Boolean(batchId),
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useFeeGenerationBills(
  batchId: string | undefined,
  filters: FeeGenerationBillsFilters = {},
) {
  return useQuery(feeGenerationBillsQueryOptions(batchId, filters));
}

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
