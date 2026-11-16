/** [59.3.G1.01] What legal documents the signed-in admin still owes, and the accept call. */
import { apiClient, type components } from '@biddaloy/ui/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

export type LegalStatus = components['schemas']['LegalStatusResponseDto'];
export type LegalDocName = LegalStatus['pending'][number];

export const legalStatusKey = ['legal', 'status'] as const;

/** `GET /legal/status`. `retry: false`: the staff gate fails open, so it must not wait on retries. */
export const legalStatusQuery = queryOptions({
  queryKey: legalStatusKey,
  queryFn: async ({ signal }): Promise<LegalStatus> =>
    (await apiClient.get<LegalStatus>('/legal/status', { signal })).data,
  staleTime: 5 * 60_000,
  retry: false,
});

/** `POST /legal/accept`. Never auto-retries (Rule 25); refreshes the status on success. */
export function useAcceptLegal() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (documents: LegalDocName[]): Promise<LegalStatus> =>
      (await apiClient.post<LegalStatus>('/legal/accept', { documents })).data,
    onSuccess: async (status) => {
      queryClient.setQueryData(legalStatusKey, status);
      await queryClient.invalidateQueries({ queryKey: legalStatusKey });
    },
  });
}
