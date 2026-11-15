import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// [71.4.01] Round (intake) and stage hooks for the Wave 4 screens.

export type CreateAdmissionRoundInput = components['schemas']['CreateIntakeDto'];
export type UpdateAdmissionRoundInput = components['schemas']['UpdateIntakeDto'];
export type AdmissionStageRow = components['schemas']['AdmissionStage'];
export type CreateAdmissionStageInput = components['schemas']['CreateStageDto'];
export type UpdateAdmissionStageInput = components['schemas']['UpdateStageDto'];
/** The intake routes have no response DTO in the schema yet, so only what the screens read. */
export type AdmissionRound = CreateAdmissionRoundInput & { id: string; status?: string };

export const admissionRoundKeys = createEntityKeys('admission-rounds');
export const admissionStageKeys = createEntityKeys<{ roundId: string }>('admission-stages');

export function useAdmissionRounds() {
  return useQuery({
    queryKey: admissionRoundKeys.lists(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<AdmissionRound[]>('/admission-intakes', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useAdmissionRound(id: string) {
  return useQuery({
    queryKey: admissionRoundKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<AdmissionRound>(`/admission-intakes/${id}`, { signal })).data,
    enabled: Boolean(id),
    retry: shouldRetryQuery,
  });
}

export function useCreateAdmissionRound() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: CreateAdmissionRoundInput) =>
      (
        await apiClient.post<AdmissionRound>('/admission-intakes', input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: admissionRoundKeys.lists() });
    },
    retry: false,
  });
}

export function useUpdateAdmissionRound(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAdmissionRoundInput) =>
      (await apiClient.patch<AdmissionRound>(`/admission-intakes/${id}`, input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: admissionRoundKeys.all }),
    retry: false,
  });
}

export function useCloseAdmissionRound(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.patch<AdmissionRound>(`/admission-intakes/${id}/close`)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: admissionRoundKeys.all }),
    retry: false,
  });
}

export function useAdmissionStages(roundId: string) {
  return useQuery({
    queryKey: admissionStageKeys.list({ roundId }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<AdmissionStageRow[]>(`/admission-intakes/${roundId}/stages`, {
          signal,
        })
      ).data,
    enabled: Boolean(roundId),
    retry: shouldRetryQuery,
  });
}

export function useCreateAdmissionStage(roundId: string) {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: CreateAdmissionStageInput) =>
      (
        await apiClient.post<AdmissionStageRow>(`/admission-intakes/${roundId}/stages`, input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: admissionStageKeys.all });
    },
    retry: false,
  });
}

export function useUpdateAdmissionStage(roundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stageId, ...input }: UpdateAdmissionStageInput & { stageId: string }) =>
      (
        await apiClient.patch<AdmissionStageRow>(
          `/admission-intakes/${roundId}/stages/${stageId}`,
          input,
        )
      ).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: admissionStageKeys.all }),
    retry: false,
  });
}

export function useRemoveAdmissionStage(roundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stageId: string) =>
      (await apiClient.delete<void>(`/admission-intakes/${roundId}/stages/${stageId}`)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: admissionStageKeys.all }),
    retry: false,
  });
}
