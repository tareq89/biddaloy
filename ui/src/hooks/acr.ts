import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useAutosave, type UseAutosaveOptions } from './autosave';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// [28.3.1] Server snake_case DTOs from the generated schema. (Not
// `shared/src/dto/evaluations.ts` — that does not match the wire shape.)
export type AcrCriterion = components['schemas']['AcrCriterionResponseDto'];
export type AcrCriteriaSet = components['schemas']['AcrCriteriaSetResponseDto'];
export type AcrCriterionInput = components['schemas']['AcrCriterionInputDto'];
export type AcrAssessment = components['schemas']['AcrAssessmentResponseDto'];
export type AcrScoreInput = components['schemas']['AcrScoreInputDto'];
export type StartAcrInput = components['schemas']['StartAcrAssessmentDto'];
export type UpdateAcrInput = components['schemas']['UpdateAcrAssessmentDto'];

export interface AcrListFilters {
  year?: string;
  status?: 'INCOMPLETE' | 'COMPLETED';
}

export const acrKeys = createEntityKeys<AcrListFilters>('acr-assessments');
export const acrCriteriaKeys = createEntityKeys('acr-criteria');
/** A staff member's ACR history, keyed by user id via `detail(userId)`. */
export const acrStaffKeys = createEntityKeys('acr-staff');

/** `versionId` reads that version's criteria (an ACR keeps the version it started on, D1). */
export function acrCriteriaQueryOptions(versionId?: string) {
  return queryOptions({
    queryKey: versionId ? acrCriteriaKeys.detail(versionId) : acrCriteriaKeys.all,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<AcrCriteriaSet>('/acr/criteria', {
          signal,
          params: versionId ? { versionId } : undefined,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

/** `enabled: false` holds the fetch until the assessment (and so its version) is known. */
export function useAcrCriteria(versionId?: string, enabled = true) {
  return useQuery({ ...acrCriteriaQueryOptions(versionId), enabled });
}

/** Saves the full list as a NEW version — existing ACRs keep their version. */
export function useSaveAcrCriteria() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (criteria: AcrCriterionInput[]) =>
      (await apiClient.put<AcrCriteriaSet>('/acr/criteria', { criteria })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: acrCriteriaKeys.all });
    },
  });
}

/** ACR register (the caller's own ACR is excluded server-side). */
export function useAcrAssessments(filters: AcrListFilters = {}) {
  return useQuery({
    queryKey: acrKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<AcrAssessment[]>('/acr/assessments', { params: filters, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useAcrAssessment(id: string | undefined) {
  return useQuery({
    queryKey: acrKeys.detail(id ?? ''),
    queryFn: async ({ signal }) =>
      (await apiClient.get<AcrAssessment>(`/acr/assessments/${id}`, { signal })).data,
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useAcrStaffHistory(userId: string | undefined) {
  return useQuery({
    queryKey: acrStaffKeys.detail(userId ?? ''),
    queryFn: async ({ signal }) =>
      (await apiClient.get<AcrAssessment[]>(`/acr/staff/${userId}`, { signal })).data,
    enabled: userId !== undefined,
    retry: shouldRetryQuery,
  });
}

function useInvalidateAcr() {
  const queryClient = useQueryClient();
  return React.useCallback(
    (a: Pick<AcrAssessment, 'id' | 'user_id'>) => {
      void queryClient.invalidateQueries({ queryKey: acrKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: acrKeys.detail(a.id) });
      void queryClient.invalidateQueries({ queryKey: acrStaffKeys.detail(a.user_id) });
    },
    [queryClient],
  );
}

export function useStartAcr() {
  const invalidate = useInvalidateAcr();
  return useMutation({
    mutationFn: async (input: StartAcrInput) =>
      (await apiClient.post<AcrAssessment>('/acr/assessments', input)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateAcr(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAcrInput) =>
      (await apiClient.patch<AcrAssessment>(`/acr/assessments/${id}`, input)).data,
    // Autosave fires often; write the server's answer into the detail cache
    // instead of refetching on every debounce.
    onSuccess: (a) => queryClient.setQueryData(acrKeys.detail(id), a),
  });
}

/** Complete — invalidates the register (status, total) and the staff history. */
export function useCompleteAcr() {
  const invalidate = useInvalidateAcr();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<AcrAssessment>(`/acr/assessments/${id}/complete`)).data,
    onSuccess: invalidate,
  });
}

export function useReopenAcr() {
  const invalidate = useInvalidateAcr();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<AcrAssessment>(`/acr/assessments/${id}/reopen`)).data,
    onSuccess: invalidate,
  });
}

/** What `useAcrAutosave` stages: a whole step's data, or one score. */
export type AcrStaged =
  | { kind: 'step1'; data: Record<string, unknown> }
  | { kind: 'step3'; data: Record<string, unknown> }
  | { kind: 'score'; score: AcrScoreInput };

/**
 * Autosave for the ACR form on top of the shared `useAutosave` engine:
 * debounces edits into one PATCH (`step1_data`, `step3_data`, changed
 * `scores`), retries with backoff on failure, and never drops a staged
 * value. Keys are `step1`, `step3`, `score:<criterionId>` so a newer edit
 * to the same field overwrites the older one.
 */
export function useAcrAutosave(
  id: string,
  options: Omit<UseAutosaveOptions<AcrStaged>, 'save'> = {},
) {
  const { mutateAsync } = useUpdateAcr(id);
  const save = React.useCallback(
    async (cells: Map<string, AcrStaged>) => {
      const body: UpdateAcrInput = {};
      const scores: AcrScoreInput[] = [];
      for (const cell of cells.values()) {
        if (cell.kind === 'step1') body.step1_data = cell.data;
        else if (cell.kind === 'step3') body.step3_data = cell.data;
        else scores.push(cell.score);
      }
      if (scores.length > 0) body.scores = scores;
      await mutateAsync(body);
    },
    [mutateAsync],
  );
  const autosave = useAutosave<AcrStaged>({ save, ...options });
  const { stage } = autosave;
  return {
    ...autosave,
    stageStep1: (data: Record<string, unknown>) => stage('step1', { kind: 'step1', data }),
    stageStep3: (data: Record<string, unknown>) => stage('step3', { kind: 'step3', data }),
    stageScore: (criterionId: string, score: AcrScoreInput['score']) =>
      stage(`score:${criterionId}`, {
        kind: 'score',
        score: { criterion_id: criterionId, score },
      }),
  };
}
