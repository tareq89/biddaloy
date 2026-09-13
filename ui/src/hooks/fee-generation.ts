import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { feeDuesKeys } from './fee-dues';
import { paymentKeys } from './payments';

/**
 * [16.3.6] Rebuild of the single-month wizard's `useGenerateFees` into the
 * single-modal "audience + fees" flow: an accountant now picks a period, a
 * set of students (search/filter or "select all N matching"), and a set of
 * fee structures directly, rather than a class/section scope alone.
 *
 * `PeriodType` mirrors D6/D9's month-or-week choice: `MONTH` carries
 * `month`/`year`, `WEEK` carries `week_start` (an ISO date, the Monday the
 * week starts on).
 */
export type PeriodType = 'MONTH' | 'WEEK';

/** Shared shape between the preview call and the real generate call — the
 * preview exists so the accountant sees duplicates/inactive students
 * *before* committing to the write, not as a separate screen. */
export interface GenerateFeesScope {
  academic_year_id: string;
  period_type: PeriodType;
  month?: number;
  year?: number;
  week_start?: string;
  due_date: string;
  student_ids: string[];
  fee_structure_ids: string[];
}

export type GenerateFeesInput = GenerateFeesScope;

export type GenerateFeesPreviewInput = GenerateFeesScope;

/** One row of "this student already has this fee for this period" — the
 * duplicates step lists these so the accountant can decide SKIP /
 * REMOVE_OLDER / CREATE_ANYWAY per D6/D13, rather than the server
 * silently `ON CONFLICT DO NOTHING`-ing them away as the old wizard did. */
export interface GenerateFeesDuplicate {
  student_id: string;
  student_name: string;
  fee_structure_id: string;
  fee_structure_name: string;
  existing_fee_id: string;
  existing_created_at: string;
}

export interface GenerateFeesInactiveStudent {
  student_id: string;
  student_name: string;
}

export interface GenerateFeesPreviewResult {
  students_evaluated: number;
  will_generate: number;
  duplicates: GenerateFeesDuplicate[];
  inactive_students: GenerateFeesInactiveStudent[];
}

/** D13's three choices for what to do with the duplicates the preview
 * found. `CREATE_ANYWAY` is the one that needs step-up approval — see
 * `useGenerateFees`'s own comment and `duplicates-step.tsx`. */
export type DuplicateAction = 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY';

export interface GenerateFeesRequest extends GenerateFeesScope {
  notify_families: boolean;
  /** Omitted when the preview found no duplicates — nothing to decide. */
  duplicate_action?: DuplicateAction;
}

export interface GenerateFeesResult {
  generated: number;
  skipped: number;
  students_evaluated: number;
}

/**
 * `POST /fees/generate/preview` — a dry run over the exact scope the
 * modal is about to submit, so the duplicates/inactive-student step can
 * show real rows instead of guessing from what's already in the query
 * cache. Not cached (`useMutation`, not `useQuery`): the answer only
 * matters for the one submission in flight and goes stale the moment the
 * accountant changes a filter.
 */
export function useGenerateFeesPreview() {
  return useMutation({
    mutationFn: async (input: GenerateFeesPreviewInput) => {
      const res = await apiClient.post<GenerateFeesPreviewResult>('/fees/generate/preview', input);
      return res.data;
    },
    retry: false,
  });
}

/**
 * `POST /fees/generate` — the plain request function, exported so
 * `useApprovedMutation`'s retry-with-token path can call it a second time
 * with the same shape (variables, `{ headers }`) it called the first
 * time. Not itself a hook — `useGenerateFees` below is the hook callers
 * actually use.
 */
async function generateFeesRequest(
  input: GenerateFeesRequest,
  options: { headers?: Record<string, string> } = {},
): Promise<GenerateFeesResult> {
  const res = await apiClient.post<GenerateFeesResult>(
    '/fees/generate',
    input,
    options.headers ? { headers: options.headers } : undefined,
  );
  return res.data;
}

/**
 * `POST /fees/generate` wrapped in `useApprovedMutation`, per the
 * published plan's correction: the option key is `approvalScope`, not
 * `scope` (`ui/src/hooks/approval.tsx:156-159` reserves `scope` for
 * TanStack Query's own mutation-concurrency option). A
 * `duplicate_action: 'CREATE_ANYWAY'` submission that comes back
 * `403 APPROVAL_REQUIRED` walks the accountant through
 * `AdminVerificationModal` and retries once with `X-Approval-Token`
 * attached — render `generate.modal` once, anywhere in the calling
 * component's tree (see `useApprovedMutation`'s own doc comment).
 *
 * `retry: false`, same reasoning the old wizard's `useGenerateFees` gave:
 * the endpoint is rate-limited (`STRICT_RATE_LIMIT`) and a batch write
 * that timed out may already have committed, so a blind client retry
 * spends one of the few allowed runs on an outcome that's already
 * unknown.
 */
export function useGenerateFees(): ApprovedMutationResult<GenerateFeesRequest, GenerateFeesResult> {
  const queryClient = useQueryClient();
  return useApprovedMutation(generateFeesRequest, {
    approvalScope: 'fees.duplicate_override',
    retry: false,
    onSuccess: () => {
      // New `StudentFee` rows change what's outstanding, so the dues queue
      // is stale — same reasoning the old wizard's hook gave.
      void queryClient.invalidateQueries({ queryKey: feeDuesKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      // `fee-generations` (plural, #654/#656) isn't a hook this ticket owns
      // or can import — invalidating the bare entity key still catches
      // every list/detail variant it defines, since TanStack Query matches
      // by key prefix.
      void queryClient.invalidateQueries({ queryKey: ['fee-generations'] });
    },
  });
}
