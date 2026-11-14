import { ApiError, apiClient, type components } from '@biddaloy/ui/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

export type InstitutionKind = components['schemas']['InstitutionKindDto'];
export type KindChanges = components['schemas']['InstitutionKindChangesDto'];

export const institutionKindsKey = ['institution-kinds'] as const;

/** GET /institution-kinds: the eight kinds (SETTINGS_MANAGE). */
export function useInstitutionKinds() {
  return useQuery({
    queryKey: institutionKindsKey,
    queryFn: async () => (await apiClient.get<InstitutionKind[]>('/institution-kinds')).data,
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /institution-kinds/:id/preview: read-only. A preview is only true at the moment it is
 * shown, so it is never served from cache (`staleTime`/`gcTime` 0).
 */
export function useKindPreview(id: string) {
  return useQuery({
    queryKey: [...institutionKindsKey, 'preview', id],
    queryFn: async () =>
      (await apiClient.post<KindChanges>(`/institution-kinds/${encodeURIComponent(id)}/preview`))
        .data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * POST /institution-kinds/:id/apply. Rule 25: `retry: false` and an `Idempotency-Key`. The key
 * is held per attempt: a second click after a lost reply re-sends the same key (the server
 * replays), and success rotates it.
 * ponytail: `useIdempotencyKey` is not exported from `@biddaloy/ui/hooks`, so one ref per hook.
 */
export function useApplyKind() {
  const qc = useQueryClient();
  const key = React.useRef<{ id: string; value: string } | undefined>(undefined);
  return useMutation({
    mutationFn: async (id: string) => {
      if (key.current?.id !== id) key.current = { id, value: crypto.randomUUID() };
      const res = await apiClient.post<KindChanges>(
        `/institution-kinds/${encodeURIComponent(id)}/apply`,
        undefined,
        { headers: { 'Idempotency-Key': key.current.value } },
      );
      return res.data;
    },
    onSuccess: async () => {
      key.current = undefined;
      // Modules and words changed: the shell's profile and the settings both re-read.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['school-profile'] }),
        qc.invalidateQueries({ queryKey: ['school-settings'] }),
      ]);
    },
    // A server answer (4xx/5xx) is a finished attempt: the next click is a new one. Only a lost reply keeps the key.
    onError: (error) => {
      if (error instanceof ApiError) key.current = undefined;
    },
    retry: false,
  });
}
