/**
 * [35.4.5] Exam template hooks — list, get, create, patch (rename / replace
 * rows), delete — against `/exam-templates` ([35.4.1]). Lives next to the
 * components, not in `ui/src/hooks`, so this lane stays file-disjoint.
 */
import { apiClient, type components } from '@biddaloy/ui/api';
import { createEntityKeys } from '@biddaloy/ui/hooks';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type ExamTemplateSummary = components['schemas']['ExamTemplateSummaryDto'];
export type ExamTemplateDetail = components['schemas']['ExamTemplateDetailDto'];
export type ExamTemplateRowInput = components['schemas']['ExamTemplateRowInputDto'];
export type CreateExamTemplateInput = components['schemas']['CreateExamTemplateDto'];
export type UpdateExamTemplateInput = components['schemas']['UpdateExamTemplateDto'];

export const examTemplateKeys = createEntityKeys('exam-templates');

export function examTemplatesQueryOptions() {
  return queryOptions({
    queryKey: examTemplateKeys.list(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ExamTemplateSummary[]>('/exam-templates', { signal })).data,
  });
}

export function useExamTemplates() {
  return useQuery(examTemplatesQueryOptions());
}

export function examTemplateQueryOptions(id: string) {
  return queryOptions({
    queryKey: examTemplateKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ExamTemplateDetail>(`/exam-templates/${id}`, { signal })).data,
  });
}

export function useExamTemplate(id: string) {
  return useQuery(examTemplateQueryOptions(id));
}

export function useCreateExamTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExamTemplateInput) =>
      (await apiClient.post<ExamTemplateDetail>('/exam-templates', input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examTemplateKeys.lists() }),
  });
}

/** `rows`, when sent, REPLACES every component row; omit it to leave them. */
export function useUpdateExamTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateExamTemplateInput) =>
      (await apiClient.patch<ExamTemplateDetail>(`/exam-templates/${id}`, input)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(examTemplateKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: examTemplateKeys.lists() });
    },
  });
}

export function useDeleteExamTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/exam-templates/${id}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examTemplateKeys.all }),
  });
}
