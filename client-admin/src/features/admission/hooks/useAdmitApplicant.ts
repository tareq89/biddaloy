/**
 * [27.10] Admit mutation — separate from `useApplicants.ts` since the
 * admit modal is its own concern (guardian-resolution outcome shown before
 * confirming, D7/D8).
 */
import type { AdmissionApplicantDto, AdmissionGuardianMatchDto } from '@biddaloy/shared';
import { ApiError, apiClient } from '@biddaloy/ui/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { applicantKeys } from './useApplicants';

export interface AdmitApplicantInput {
  notes?: string;
  /** Required by the server when the applicant's phone matches an existing guardian. */
  guardian_choice?: 'LINK_EXISTING' | 'CREATE_NEW';
  /** The guardian staff were shown; required with `LINK_EXISTING`. */
  guardian_id?: string;
}

const MATCH_CODES = new Set(['GUARDIAN_MATCH_NEEDS_CHOICE', 'GUARDIAN_MATCH_CHANGED']);

/** [LIFE-09] The existing guardian this applicant's phone would attach to, if any. */
export function useGuardianMatch(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...applicantKeys.detail(id), 'guardian-match'],
    enabled,
    queryFn: async () => {
      const res = await apiClient.get<AdmissionGuardianMatchDto>(
        `/admission/applicants/${id}/guardian-match`,
      );
      return res.data;
    },
  });
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
    onError: (error) => {
      // A guardian appeared or changed after the modal opened: show the fresh match.
      if (error instanceof ApiError && MATCH_CODES.has(String(error.details?.code))) {
        void queryClient.invalidateQueries({
          queryKey: [...applicantKeys.detail(id), 'guardian-match'],
        });
      }
    },
  });
}
