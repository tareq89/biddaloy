import { ApprovalScope } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- interim types: [20.3.1] `/grading/scales*` (server: #907/#908) ----
// `schema.d.ts` now includes the generated `GradingScaleDto`/`GradingBandDto`
// equivalents and these match them field-for-field — kept hand-typed rather
// than swapped, same as `discount-rules.ts`'s own still-unswapped reconciliation
// note for #677. `RecomputePreviewResult`/`RecomputeProblem` below have no
// generated equivalent yet: `GradingController_previewBands_v1`'s response is
// `Record<string, never>` in the generated schema, since #908's controller
// doesn't declare an `@ApiResponse` type for it.

export interface GradingBand {
  id: string;
  percent_from: number;
  percent_to: number;
  grade: string;
  gpa: number | null;
  is_fail: boolean;
  sequence: number;
  comment: string | null;
}

export interface GradingScale {
  id: string;
  academic_year_id: string;
  class_id: string | null;
  name: string;
  revision: number;
  bands: GradingBand[];
}

export interface BandInput {
  percent_from: number;
  percent_to: number;
  grade: string;
  gpa?: number | null;
  is_fail?: boolean;
  sequence: number;
  comment?: string | null;
}

export interface CreateGradingScaleInput {
  academic_year_id: string;
  class_id?: string | null;
  name: string;
}

export interface UpdateGradingScaleInput {
  name?: string;
}

export interface CopyScaleInput {
  source_scale_id: string;
}

export interface RecomputeProblem {
  type: string;
  message: string;
  index?: number;
}

export interface RecomputePreviewResult {
  valid: boolean;
  problems: RecomputeProblem[];
  bands_changed: boolean;
  affected_result_count: number;
}

export interface ConfirmBandsResult {
  scale: GradingScale;
  affected_result_count: number;
}

export interface GradingScaleListFilters {
  academic_year_id?: string;
}

export const gradingScaleKeys = createEntityKeys<GradingScaleListFilters>('grading-scales');

export function gradingScalesQueryOptions(filters: GradingScaleListFilters = {}) {
  const queryKey = gradingScaleKeys.list(filters);
  return queryOptions({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get<GradingScale[]>('/grading/scales', { params: filters });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useGradingScales(filters: GradingScaleListFilters = {}) {
  return useQuery(gradingScalesQueryOptions(filters));
}

export function gradingScaleQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: gradingScaleKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<GradingScale>(`/grading/scales/${id}`);
      return res.data;
    },
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useGradingScale(id: string | undefined) {
  return useQuery(gradingScaleQueryOptions(id));
}

export function useCreateGradingScale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGradingScaleInput) => {
      const res = await apiClient.post<GradingScale>('/grading/scales', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.lists() });
    },
  });
}

export function useUpdateGradingScale(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateGradingScaleInput) => {
      const res = await apiClient.patch<GradingScale>(`/grading/scales/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.lists() });
    },
  });
}

export function useDeleteGradingScale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/grading/scales/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.lists() });
      queryClient.removeQueries({ queryKey: gradingScaleKeys.detail(id) });
    },
  });
}

/** `POST /grading/scales/:id/copy` — refused server-side if the target
 * scale already has bands (`GradingService.copy`). Not approval-gated:
 * only `confirmBands` (a band-set *replace*) is, per the controller. */
export function useCopyGradingScale(targetScaleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyScaleInput) => {
      const res = await apiClient.post<GradingBand[]>(
        `/grading/scales/${targetScaleId}/copy`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.detail(targetScaleId) });
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.lists() });
    },
  });
}

/** Writes nothing — reports validation problems and how many results
 * would change. Not approval-gated. */
export function usePreviewBands(scaleId: string) {
  return useMutation({
    mutationFn: async (bands: BandInput[]) => {
      const res = await apiClient.post<RecomputePreviewResult>(
        `/grading/scales/${scaleId}/bands/preview`,
        { bands },
      );
      return res.data;
    },
  });
}

/** `POST /grading/scales/:id/bands/confirm` — replaces the band set and
 * recomputes affected results. Approval-gated
 * (`ApprovalScope.GRADING_SCALE_MANAGE`): `useApprovedMutation` retries
 * once with an `X-Approval-Token` on a `403 APPROVAL_REQUIRED`. */
export function useConfirmBands(
  scaleId: string,
): ApprovedMutationResult<BandInput[], ConfirmBandsResult> {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async (bands, options) =>
      (
        await apiClient.post<ConfirmBandsResult>(
          `/grading/scales/${scaleId}/bands/confirm`,
          { bands },
          options,
        )
      ).data,
    {
      approvalScope: ApprovalScope.GRADING_SCALE_MANAGE,
      retry: false,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.detail(scaleId) });
        void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.lists() });
      },
    },
  );
}
