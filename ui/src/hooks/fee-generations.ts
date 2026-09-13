import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';

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
  /** Not part of `FeeGenerationListItemDto` — the list endpoint's `qb`
   * never selects `fg.structures`, only the join it drives (`fee_type`
   * filtering via a jsonb containment check). `batch-table.tsx`'s fee
   * chips therefore have nothing to render for a list row today; this is
   * flagged in the PR body as an endpoint-shape gap against the issue's
   * "fees (chips from `structures` snapshot)" column spec. Kept optional
   * here (rather than omitted) so a future widening of
   * `FeeGenerationListItemDto` to include it is a additive, non-breaking
   * change for this type. */
  structures?: FeeGenerationStructureSnapshot[];
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
 * flagged in the PR body as the same kind of endpoint-shape gap as
 * `FeeGeneration.structures` above. */
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
