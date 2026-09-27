/**
 * [27.10] Admit mutation — separate from `useApplicants.ts` since the
 * admit modal is its own concern (guardian-resolution outcome shown before
 * confirming, D7/D8).
 */
import type { AdmissionApplicantDto } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { applicantKeys } from './useApplicants';

export interface AdmitApplicantInput {
  notes?: string;
}

export function useAdmitApplicant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdmitApplicantInput) => {
      const res = await apiClient.post<AdmissionApplicantDto>(
        `/admission/applicants/${id}/admit`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: applicantKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: applicantKeys.lists() });
    },
  });
}
