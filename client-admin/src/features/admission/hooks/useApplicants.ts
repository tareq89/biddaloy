/**
 * [27.10] Staff read/evaluate/reject hooks over `/admission/applicants`
 * (server: wave 2/3, `server/src/modules/admission/applicant-review.controller.ts`).
 * `useAdmitApplicant` lives in its own file (`useAdmitApplicant.ts`) since
 * the admit modal is a separate ticket concern (guardian-resolution outcome).
 */
import type {
  AdmissionApplicantDto,
  AdmissionApplicantStatus,
  AdmissionEvaluationDecision,
  AdmissionEvaluationDto,
} from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface ApplicantFilters {
  intakeId?: string;
  status?: AdmissionApplicantStatus;
}

export interface ApplicantWithHistory {
  applicant: AdmissionApplicantDto;
  evaluations: AdmissionEvaluationDto[];
}

export interface EvaluateApplicantInput {
  notes: string;
  decision?: Exclude<AdmissionEvaluationDecision, 'ADMIT'>;
}

const applicantKeys = {
  all: ['admission-applicants'] as const,
  lists: () => [...applicantKeys.all, 'list'] as const,
  list: (filters: ApplicantFilters) => [...applicantKeys.lists(), filters] as const,
  detail: (id: string) => [...applicantKeys.all, 'detail', id] as const,
};

export function applicantsQueryOptions(filters: ApplicantFilters = {}) {
  return queryOptions({
    queryKey: applicantKeys.list(filters),
    queryFn: async () => {
      const res = await apiClient.get<AdmissionApplicantDto[]>('/admission/applicants', {
        params: filters,
      });
      return res.data;
    },
  });
}

export function useApplicants(filters: ApplicantFilters = {}) {
  return useQuery(applicantsQueryOptions(filters));
}

export function applicantQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: applicantKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<ApplicantWithHistory>(`/admission/applicants/${id}`);
      return res.data;
    },
    enabled: id !== undefined,
  });
}

export function useApplicant(id: string | undefined) {
  return useQuery(applicantQueryOptions(id));
}

export function useEvaluateApplicant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EvaluateApplicantInput) => {
      const res = await apiClient.post<AdmissionApplicantDto>(
        `/admission/applicants/${id}/evaluate`,
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

export function useRejectApplicant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notes?: string) => {
      const res = await apiClient.post<AdmissionApplicantDto>(
        `/admission/applicants/${id}/reject`,
        {
          notes,
        },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: applicantKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: applicantKeys.lists() });
    },
  });
}

export { applicantKeys };
