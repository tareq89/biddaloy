import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// [28.4.1] Wire shapes, all taken from the generated schema (snake_case entity/detail,
// camelCase DTOs and results). Names below are kept as aliases so consumers don't change.
type Schemas = components['schemas'];
export type Survey = Schemas['Survey'];
export type SurveyStatus = Survey['status'];
export type SurveyRespondent = Survey['respondent'];
export type CreateSurveyInput = Schemas['CreateSurveyDto'];
export type SurveyQuestionInput = Schemas['SurveyQuestionInputDto'];
export type RespondSurveyInput = Schemas['RespondSurveyDto'];
export type SurveyQuestion = Schemas['SurveyQuestionDto'];
export type SurveyTarget = Schemas['SurveyTargetDto'];
export type SurveyDetail = Schemas['SurveyDetailDto'];

/** One open survey with the caller's still-unanswered teacher-subject pairs (`anonymous` is a UI label only: never "untraceable"). */
export type PendingSurvey = Schemas['PendingSurveyDto'];

export type SurveyQuestionResult = Schemas['SurveyQuestionResult'];
/** `hidden: true` carries only the count — sealed until CLOSED and min responses met. */
export type SurveyPairResult = SurveyResults['results'][number];
export type SurveyResults = Schemas['SurveyResultsDto'];

export const surveyKeys = createEntityKeys<Record<string, never>>('surveys');
const mineKey = [...surveyKeys.all, 'mine'] as const;
const resultsKey = (id: string) => [...surveyKeys.all, 'results', id] as const;

export function useSurveys() {
  return useQuery({
    queryKey: surveyKeys.list(),
    queryFn: async ({ signal }) => (await apiClient.get<Survey[]>('/surveys', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useSurvey(id: string) {
  return useQuery({
    queryKey: surveyKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SurveyDetail>(`/surveys/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useCreateSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSurveyInput) =>
      (await apiClient.post<SurveyDetail>('/surveys', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
    },
  });
}

/** `PATCH /surveys/:id` — DRAFT only; accepts the same fields as create, all optional. */
export function useUpdateSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & Partial<CreateSurveyInput>) =>
      (await apiClient.patch<SurveyDetail>(`/surveys/${id}`, input)).data,
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: surveyKeys.detail(id) });
    },
  });
}

function useSurveyTransition(action: 'publish' | 'close') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<SurveyDetail>(`/surveys/${id}/${action}`)).data,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: surveyKeys.detail(id) });
      // Closing is what unseals results.
      void queryClient.invalidateQueries({ queryKey: resultsKey(id) });
      void queryClient.invalidateQueries({ queryKey: mineKey });
    },
  });
}

export const usePublishSurvey = () => useSurveyTransition('publish');
export const useCloseSurvey = () => useSurveyTransition('close');

/** Family side: OPEN surveys with the caller's pending pairs (with teacher and subject display names). */
export function useMySurveys() {
  return useQuery({
    queryKey: mineKey,
    queryFn: async ({ signal }) =>
      (await apiClient.get<PendingSurvey[]>('/surveys/mine', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useRespondSurvey(surveyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RespondSurveyInput) =>
      (await apiClient.post<{ submitted: true }>(`/surveys/${surveyId}/respond`, input)).data,
    // A 409 (already answered) also means the pair is no longer pending.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mineKey });
    },
  });
}

/** Results pass through unchanged, including the sealed `{count, hidden: true}` shape. */
export function useSurveyResults(id: string) {
  return useQuery({
    queryKey: resultsKey(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SurveyResults>(`/surveys/${id}/results`, { signal })).data,
    retry: shouldRetryQuery,
  });
}
