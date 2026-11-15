import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// [71.4.01] Wave 4 hooks: applicants, fee proofs, stage results, lottery, lists, publication.
// Every mutation is `retry: false` (Rule 25); creates and sends carry an `Idempotency-Key`.

type S = components['schemas'];
export type ApplicantList = S['ApplicantListResponseDto'];
export type FeeProofList = S['FeeProofListResponseDto'];
export type FeeState = S['AdmissionFeeState'];
export type PutStageResultsInput = S['PutStageResultsDto'];
export type CutoffPreviewInput = S['CutoffPreviewDto'];
export type CutoffPreview = S['CutoffPreviewResponseDto'];
export type CutoffCommitInput = S['CutoffCommitDto'];
export type LotteryDraw = S['LotteryDrawResponseDto'];
export type LotteryImportValidation = S['LotteryImportValidateResponseDto'];
export type CommitLotteryImportInput = S['CommitLotteryImportDto'];
export type AdmissionLists = S['AdmissionListsResponseDto'];
export type ListAction = S['ListActionResponseDto'];
export type CreateMeritListInput = S['CreateMeritListDto'];
export type CreateWaitingListInput = S['CreateWaitingListDto'];
export type PatchMembersInput = S['PatchMembersDto'];
/** Local on purpose: the generated `PublishDto` / `PublishResponseDto` are the website's, not
 * the admission ones (Swagger name clash). Mirrors `server/.../admission-publication.dto.ts`. */
export type PublishWhat = 'STAGE' | 'MERIT' | 'WAITING';
export interface PublishInput {
  what: PublishWhat;
  ref_id: string;
  send_sms: boolean;
  include_not_selected?: boolean;
}
export interface PublishResult {
  sms_attempted: number;
}
export type PublishEstimate = S['PublishEstimateResponseDto'];
export type CallListRow = S['CallListRowDto'];
export type StageResultRow = S['StageResultListRowDto'];
export type AssignRollsResult = S['AssignRollsResponseDto'];
export type StageScheduleInput = S['StageScheduleDto'];
export type SendBackFeeProofInput = S['SendBackFeeProofDto'];

export interface ApplicantFilters {
  intakeId?: string;
  status?:
    | 'PENDING'
    | 'SHORTLISTED'
    | 'ADMITTED'
    | 'REJECTED'
    | 'FEE_PENDING'
    | 'OFFERED'
    | 'WAITING'
    | 'EXPIRED';
  search?: string;
  /** Only applicants in this stage (eligible for it). */
  stage_id?: string;
  sort?: 'newest' | 'roll';
  page?: number;
  limit?: number;
}
export interface FeeProofFilters {
  intakeId?: string;
  state?: FeeState;
  page?: number;
  limit?: number;
}

export const admissionApplicantKeys = createEntityKeys<ApplicantFilters>('admission-applicants');
export const admissionFeeProofKeys = createEntityKeys<FeeProofFilters>('admission-fee-proofs');
export const admissionStageResultKeys = createEntityKeys<{ stageId: string }>(
  'admission-stage-results',
);
export const admissionListKeys = createEntityKeys('admission-lists');
export const admissionCallListKeys = createEntityKeys<{ roundId: string; listId: string }>(
  'admission-call-list',
);

export function useAdmissionApplicants(filters: ApplicantFilters) {
  return useQuery({
    queryKey: admissionApplicantKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ApplicantList>('/admission/applicants', { params: filters, signal }))
        .data,
    retry: shouldRetryQuery,
  });
}

export function useFeeProofs(filters: FeeProofFilters, enabled = true) {
  return useQuery({
    enabled,
    queryKey: admissionFeeProofKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<FeeProofList>('/admission/fee-proofs', { params: filters, signal }))
        .data,
    retry: shouldRetryQuery,
  });
}

/** A fee decision changes the applicant row and the fee list. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) =>
    keys.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
}

export function useConfirmFeeProof() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<S['FeeDecisionResponseDto']>(`/admission/fee-proofs/${id}/confirm`))
        .data,
    onSuccess: () => invalidate(admissionFeeProofKeys.all, admissionApplicantKeys.all),
    retry: false,
  });
}

export function useSendBackFeeProof(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: SendBackFeeProofInput) =>
      (
        await apiClient.post<S['FeeDecisionResponseDto']>(
          `/admission/fee-proofs/${id}/send-back`,
          input,
        )
      ).data,
    onSuccess: () => invalidate(admissionFeeProofKeys.all, admissionApplicantKeys.all),
    retry: false,
  });
}

// ---- Stages: results, cut-off, lottery ----

const RESULTS_PAGE = 100;
/** Stage rows carry cutoff_committed_at, so a save or commit refreshes them. */
const STAGES = ['admission-stages'] as const;

/** Every saved row of a stage, all pages (the grid prefills from it). */
export function useStageResults(stageId: string) {
  return useQuery({
    enabled: Boolean(stageId),
    queryKey: admissionStageResultKeys.list({ stageId }),
    queryFn: async ({ signal }) => {
      const rows: StageResultRow[] = [];
      for (let page = 1; ; page++) {
        const res = (
          await apiClient.get<S['StageResultListResponseDto']>(
            `/admission/stages/${stageId}/results`,
            { params: { page, limit: RESULTS_PAGE }, signal },
          )
        ).data;
        rows.push(...res.data);
        if (page >= res.totalPages) return rows;
      }
    },
    retry: shouldRetryQuery,
  });
}

export function useAssignRolls(roundId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (order: 'APPLIED_AT' | 'NAME') =>
      (await apiClient.post<AssignRollsResult>(`/admission/intakes/${roundId}/rolls`, { order }))
        .data,
    onSuccess: () => invalidate(admissionApplicantKeys.all),
    retry: false,
  });
}

export function useSetStageSchedule(stageId: string) {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: StageScheduleInput) =>
      (
        await apiClient.patch<S['StageScheduleResponseDto']>(
          `/admission/stages/${stageId}/schedule`,
          input,
          { headers: { 'Idempotency-Key': keyFor({ stageId, ...input }) } },
        )
      ).data,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: ['admission-stages'] });
    },
    retry: false,
  });
}

export function usePutStageResults(stageId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: PutStageResultsInput) =>
      (
        await apiClient.put<S['PutStageResultsResponseDto']>(
          `/admission/stages/${stageId}/results`,
          input,
        )
      ).data,
    onSuccess: () => invalidate(admissionApplicantKeys.all, admissionStageResultKeys.all, STAGES),
    retry: false,
  });
}

/** A preview writes nothing; it is a POST only because the cut-off rides in the body. */
export function useCutoffPreview(stageId: string) {
  return useMutation({
    mutationFn: async (input: CutoffPreviewInput) =>
      (await apiClient.post<CutoffPreview>(`/admission/stages/${stageId}/cutoff/preview`, input))
        .data,
    retry: false,
  });
}

export function useCommitCutoff(stageId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: CutoffCommitInput) =>
      (
        await apiClient.post<S['CutoffCommitResponseDto']>(
          `/admission/stages/${stageId}/cutoff/commit`,
          input,
        )
      ).data,
    onSuccess: () => invalidate(admissionApplicantKeys.all, admissionStageResultKeys.all, STAGES),
    retry: false,
  });
}

export function useDrawLottery(stageId: string) {
  const invalidate = useInvalidate();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<LotteryDraw>(`/admission/stages/${stageId}/lottery/draw`, undefined, {
          headers: { 'Idempotency-Key': keyFor({ stageId }) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      invalidate(admissionApplicantKeys.all, admissionStageResultKeys.all, STAGES);
    },
    retry: false,
  });
}

export function useValidateLotteryImport(stageId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (
        await apiClient.post<LotteryImportValidation>(
          `/admission/stages/${stageId}/lottery/import/validate`,
          form,
        )
      ).data;
    },
    retry: false,
  });
}

export function useCommitLotteryImport(stageId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: CommitLotteryImportInput) =>
      (
        await apiClient.post<S['LotteryImportCommitResponseDto']>(
          `/admission/stages/${stageId}/lottery/import/commit`,
          input,
        )
      ).data,
    onSuccess: () => invalidate(admissionApplicantKeys.all, admissionStageResultKeys.all, STAGES),
    retry: false,
  });
}

// ---- Lists ----

export function useAdmissionLists(roundId: string) {
  return useQuery({
    queryKey: admissionListKeys.detail(roundId),
    queryFn: async ({ signal }) =>
      (await apiClient.get<AdmissionLists>(`/admission/intakes/${roundId}/lists`, { signal })).data,
    enabled: Boolean(roundId),
    retry: shouldRetryQuery,
  });
}

function useListWrite<TInput>(path: (input: TInput) => string, create: boolean) {
  const invalidate = useInvalidate();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: TInput) =>
      (
        await apiClient.post<ListAction>(
          path(input),
          input,
          create ? { headers: { 'Idempotency-Key': keyFor(input) } } : undefined,
        )
      ).data,
    onSuccess: () => {
      rotate();
      invalidate(admissionListKeys.all, admissionApplicantKeys.all);
    },
    retry: false,
  });
}

export const useCreateMeritList = (roundId: string) =>
  useListWrite<CreateMeritListInput>(() => `/admission/intakes/${roundId}/lists/merit`, true);
export const useCreateWaitingList = (roundId: string) =>
  useListWrite<CreateWaitingListInput>(() => `/admission/intakes/${roundId}/lists/waiting`, true);
export const useActivateList = () =>
  useListWrite<{ id: string }>(({ id }) => `/admission/lists/${id}/activate`, false);
export const useExpirePendingList = () =>
  useListWrite<{ id: string }>(({ id }) => `/admission/lists/${id}/expire-pending`, false);

export function usePatchListMembers(listId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: PatchMembersInput) =>
      (await apiClient.patch<ListAction>(`/admission/lists/${listId}/members`, input)).data,
    onSuccess: () => invalidate(admissionListKeys.all, admissionApplicantKeys.all),
    retry: false,
  });
}

// ---- Publication ----

export function usePublishEstimate(
  roundId: string,
  what: PublishWhat,
  refId: string,
  includeNotSelected?: boolean,
) {
  return useQuery({
    queryKey: [
      ...admissionListKeys.all,
      'estimate',
      roundId,
      what,
      refId,
      includeNotSelected ?? false,
    ],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PublishEstimate>(`/admission/intakes/${roundId}/publish/estimate`, {
          params: { what, ref_id: refId, include_not_selected: includeNotSelected },
          signal,
        })
      ).data,
    enabled: Boolean(roundId && refId),
    retry: shouldRetryQuery,
  });
}

/** Sends SMS, so the same attempt replays instead of texting twice. */
export function usePublish(roundId: string) {
  const invalidate = useInvalidate();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: PublishInput) =>
      (
        await apiClient.post<PublishResult>(`/admission/intakes/${roundId}/publish`, input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      invalidate(admissionListKeys.all, admissionCallListKeys.all);
    },
    retry: false,
  });
}

export function useCallList(roundId: string, listId: string) {
  return useQuery({
    queryKey: admissionCallListKeys.list({ roundId, listId }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<CallListRow[]>(`/admission/intakes/${roundId}/call-list`, {
          params: { list_id: listId },
          signal,
        })
      ).data,
    enabled: Boolean(roundId && listId),
    retry: shouldRetryQuery,
  });
}

export function useSetCalled() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ applicantId, ...input }: S['SetCalledDto'] & { applicantId: string }) =>
      (
        await apiClient.patch<S['SetCalledResponseDto']>(
          `/admission/call-list/${applicantId}`,
          input,
        )
      ).data,
    onSuccess: () => invalidate(admissionCallListKeys.all),
    retry: false,
  });
}
