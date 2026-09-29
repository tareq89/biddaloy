import { ApprovalScope } from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { feeDuesKeys } from './fee-dues';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- Fine rules (`/fees/fine-rules`) ----

export type FineRule = components['schemas']['FineRuleDto'];
export type CreateFineRuleInput = components['schemas']['CreateFineRuleDto'];
export type UpdateFineRuleInput = components['schemas']['UpdateFineRuleDto'] & { id: string };
export interface DeleteFineRuleInput {
  id: string;
}
export type CopyFineRulesInput = components['schemas']['CopyFineRulesDto'];

const fineRuleKeys = createEntityKeys<{ academicYearId: string }, string>('fine-rules');

/** [38.3.1] `GET /fees/fine-rules?academic_year_id=` — the rule list the
 * fine-rules screen (wave 4) renders. */
export function useFineRules(academicYearId: string) {
  return useQuery({
    queryKey: fineRuleKeys.list({ academicYearId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<FineRule[]>('/fees/fine-rules', {
        params: { academic_year_id: academicYearId },
        signal,
      });
      return res.data;
    },
    enabled: Boolean(academicYearId),
    retry: shouldRetryQuery,
  });
}

export function useCreateFineRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFineRuleInput) =>
      (await apiClient.post<FineRule>('/fees/fine-rules', input)).data,
    onSuccess: (rule) => {
      void queryClient.invalidateQueries({
        queryKey: fineRuleKeys.list({ academicYearId: rule.academic_year_id }),
      });
    },
  });
}

export function useUpdateFineRule(academicYearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateFineRuleInput) =>
      (await apiClient.patch<FineRule>(`/fees/fine-rules/${id}`, body)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fineRuleKeys.list({ academicYearId }) });
    },
  });
}

export function useDeleteFineRule(academicYearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: DeleteFineRuleInput) => {
      await apiClient.delete<void>(`/fees/fine-rules/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fineRuleKeys.list({ academicYearId }) });
    },
  });
}

/** `POST /fees/fine-rules/copy` — idempotent copy from one academic year's
 * fine rules (and the FINE fee structures they point at) to another, for
 * the rule form's "Copy from last year" action. */
export function useCopyFineRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyFineRulesInput) => {
      await apiClient.post<void>('/fees/fine-rules/copy', input);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: fineRuleKeys.list({ academicYearId: variables.to_academic_year_id }),
      });
    },
  });
}

// ---- Fines (`/fees/fines`) ----

/** `GET /fees/fines`'s 200 body is `content?: never` in `schema.d.ts` (the
 * controller never declared an `@ApiResponse` type) — same documented gap
 * `fee-dues.ts`'s `PaginatedFeeDues` calls out for its sibling endpoint.
 * Hand-typed against the ticket's contract: `{ items, total, totals }`. */
export type Fine = components['schemas']['StudentFee'];

export interface FineTotals {
  charged: number;
  collected: number;
  waived: number;
  outstanding: number;
}

export interface PaginatedFines {
  items: Fine[];
  total: number;
  totals: FineTotals;
}

export interface FinesFilters {
  academic_year_id?: string;
  month?: number;
  class_id?: string;
  section_id?: string;
  student_id?: string;
  fee_structure_id?: string;
  origin?: 'RULE' | 'MANUAL';
  status?: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'WAIVED' | 'ADVANCE';
  page?: number;
  limit?: number;
}

export const finesKeys = createEntityKeys<FinesFilters>('fines');

/** [38.3.1] `GET /fees/fines` — the fines list + totals footer (charged /
 * collected / waived / outstanding) the fines screen (wave 4) renders. */
export function useFines(filters: FinesFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: finesKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedFines>('/fees/fines', { params: filters, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
    // [38.4.5] `portal/fees.tsx` calls this before its own student id is
    // known (`/students/mine` still in flight) — an unguarded call would
    // fire a filterless `GET /fees/fines`, the tenant-wide staff list, same
    // reasoning `portal/fees.tsx`'s `invoicesQuery` documents for itself.
    enabled: options.enabled ?? true,
  });
}

export type LogFineInput = components['schemas']['LogFineDto'];
export type LogFineResult = components['schemas']['LogFineResultDto'];

/** `POST /fees/fines` — logs a manual fine against one or more students. Not
 * approval-gated (only waiving one, and CREATE_ANYWAY on the sweep, are). */
export function useLogFine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogFineInput) =>
      (await apiClient.post<LogFineResult>('/fees/fines', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: finesKeys.all });
      void queryClient.invalidateQueries({ queryKey: feeDuesKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['student-fees'] });
    },
  });
}

export type WaiveFineInput = components['schemas']['WaiveFineDto'] & { id: string };
export type WaiveFineResult = components['schemas']['WaiveFineResultDto'];

/** `POST /fees/fines/:id/waive` — the server (`fines.service.ts`) consumes
 * an approval token with `ApprovalScope.FEES_DISCOUNT`, the same scope a
 * discount uses — not `Permission.FEE_APPROVE` (that's the route's static
 * `@RequirePermissions`, a different axis from the step-up scope). Same
 * `403 APPROVAL_REQUIRED` retry `discount-rules.ts`/`payments.ts` use. */
export function useWaiveFine(): ApprovedMutationResult<WaiveFineInput, WaiveFineResult> {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async ({ id, ...body }, options) =>
      (await apiClient.post<WaiveFineResult>(`/fees/fines/${id}/waive`, body, options)).data,
    {
      approvalScope: ApprovalScope.FEES_DISCOUNT,
      retry: false,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: finesKeys.all });
        void queryClient.invalidateQueries({ queryKey: feeDuesKeys.all });
        void queryClient.invalidateQueries({ queryKey: ['student-fees'] });
      },
    },
  );
}

// ---- Fine sweep (attendance-driven fine generation) ----

export type FineSweepFilters = components['schemas']['FineSweepQueryDto'];
export type FineSweepPreviewResult = components['schemas']['FineSweepPreviewResultDto'];
export type FineSweepGenerateInput = components['schemas']['FineSweepGenerateDto'];
export type FineSweepGenerateResult = components['schemas']['FineSweepGenerateResultDto'];

/** `POST /fees/fines/generate/preview` — a read-only dry run, same
 * reasoning `fee-generation.ts`'s `useGenerateFeesPreview` gives: not
 * cached, the answer only matters for the submission about to happen. */
export function usePreviewFineGeneration() {
  return useMutation({
    mutationFn: async (input: FineSweepFilters) =>
      (await apiClient.post<FineSweepPreviewResult>('/fees/fines/generate/preview', input)).data,
    retry: false,
  });
}

async function generateFinesRequest(
  input: FineSweepGenerateInput,
  options: { headers?: Record<string, string> } = {},
): Promise<FineSweepGenerateResult> {
  const res = await apiClient.post<FineSweepGenerateResult>(
    '/fees/fines/generate',
    input,
    options.headers ? { headers: options.headers } : undefined,
  );
  return res.data;
}

/** `POST /fees/fines/generate` — approval-gated exactly like
 * `fee-generation.ts`'s `useGenerateFees`: `REMOVE_OLDER`/`CREATE_ANYWAY`
 * over a paid bill needs a fresh `X-Approval-Token` for
 * `fees.duplicate_override`. `retry: false` for the same rate-limit reason
 * `useGenerateFees` documents. */
export function useGenerateFines(): ApprovedMutationResult<
  FineSweepGenerateInput,
  FineSweepGenerateResult
> {
  const queryClient = useQueryClient();
  return useApprovedMutation(generateFinesRequest, {
    approvalScope: 'fees.duplicate_override',
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: finesKeys.all });
      void queryClient.invalidateQueries({ queryKey: feeDuesKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['student-fees'] });
    },
  });
}
