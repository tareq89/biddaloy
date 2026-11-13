import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { clampLimit } from './platform-impersonation';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type SupportAccessSettings = S['SupportAccessSettingsResponseDto'];
export type SupportAccessMode = SupportAccessSettings['mode'];
export type SupportRequestItem = S['SupportRequestItemDto'];
export type SupportSessionItem = S['SupportSessionItemDto'];
export type PlatformActionItem = S['PlatformActionItemDto'];

export const supportAccessKeys = createEntityKeys<Record<string, unknown>>('support-access');
const settingsKey = supportAccessKeys.detail('settings');

/** School side (admin with SETTINGS_MANAGE): who may open Login as on this school. */
export function useSupportAccessSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async ({ signal }) =>
      (await apiClient.get<SupportAccessSettings>('/support-access/settings', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useChangeSupportAccessMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: SupportAccessMode) =>
      (await apiClient.put<SupportAccessSettings>('/support-access/settings', { mode })).data,
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: supportAccessKeys.all }),
  });
}

export function useConfirmSupportAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { allowed: boolean; textVersion: number }) =>
      (await apiClient.post<SupportAccessSettings>('/support-access/confirm', input)).data,
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: supportAccessKeys.all }),
  });
}

export function useSupportRequests(
  params: { status?: 'pending' | 'decided'; limit?: number; page?: number } = {},
) {
  const query = { status: params.status, limit: clampLimit(params.limit), page: params.page };
  return useQuery({
    queryKey: supportAccessKeys.list({ kind: 'requests', ...query }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<SupportRequestItem[]>('/support-access/requests', {
          params: query,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

/** One request of this school by id (tenant-scoped on the server), not a slot in a capped list. */
export function useSupportRequest(id: string) {
  return useQuery({
    queryKey: supportAccessKeys.detail(`request-${id}`),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SupportRequestItem>(`/support-access/requests/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useDecideSupportRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) =>
      (
        await apiClient.post<S['SupportRequestDecisionDto']>(
          `/support-access/requests/${id}/${decision}`,
        )
      ).data,
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: supportAccessKeys.all }),
  });
}

export function useSupportSessions(params: { days?: number; page?: number; limit?: number } = {}) {
  const query = { ...params, limit: clampLimit(params.limit) };
  return useQuery({
    queryKey: supportAccessKeys.list({ kind: 'sessions', ...query }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<SupportSessionItem[]>('/support-access/sessions', {
          params: query,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useSupportPlatformActions(
  params: { days?: number; page?: number; limit?: number } = {},
) {
  const query = { ...params, limit: clampLimit(params.limit) };
  return useQuery({
    queryKey: supportAccessKeys.list({ kind: 'platform-actions', ...query }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PlatformActionItem[]>('/support-access/platform-actions', {
          params: query,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useEndSupportSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await apiClient.post<S['EndSupportSessionResultDto']>(`/support-access/sessions/${id}/end`))
        .data,
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: supportAccessKeys.all }),
  });
}
