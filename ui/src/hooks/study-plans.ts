import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components, operations } from '../api/schema';

import { withHttpStatusShape } from './bulk-upload';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import type { PreviewResult } from './use-bulk-upload-preview';

export { LessonDeliveryReason, LessonDeliveryStatus, type StudyPlanLesson } from '@biddaloy/shared';

type Schemas = components['schemas'];
type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

// ---- Types: every one is an alias of a generated schema type. ----
export type StudyPlanListResponse = Schemas['PlanListResponseDto'];
export type StudyPlanDetail = Schemas['StudyPlanDetailDto'];
export type StudyPlanScheduleResponse = Schemas['PlanScheduleResponseDto'];
export type StudyPlanCapacityResponse = Schemas['PlanCapacityResponseDto'];
export type StudyPlanCarryOverResponse = Schemas['CarryOverResponseDto'];
export type CreateStudyPlanInput = Schemas['CreateStudyPlanDto'];
export type UpdateStudyPlanInput = Schemas['UpdateStudyPlanDto'];
export type SaveStudyPlanLessonsInput = Schemas['ReplaceLessonsDto'];
export type SaveStudyPlanExamMarkersInput = Schemas['SetExamMarkersDto'];
export type CopyStudyPlanToSectionInput = Schemas['CopyToSectionDto'];
export type CommitStudyPlanImportInput = Schemas['CommitStudyPlanImportDto'];
export type StudyPlanImportValidateResult = Schemas['StudyPlanImportValidateResultDto'];
export type StudyPlanImportCommitResult =
  Schemas['StudyPlanDetailDto'] | Schemas['StudyPlanTemplateDetailDto'];
export type LessonDeliveriesDay = Schemas['LessonDeliveriesDayDto'];
export type PutLessonDeliveryInput = Schemas['PutLessonDeliveryDto'];
export type ExtraLessonDeliveryInput = Schemas['ExtraLessonDeliveryDto'];
export type SavedLessonDelivery = Schemas['SavedLessonDeliveryDto'];
export type TodayAllTaughtResponse = Schemas['TodayAllTaughtResponseDto'];
export type StudyPlanTemplateList = Schemas['StudyPlanTemplateListDto'];
export type StudyPlanTemplateDetail = Schemas['StudyPlanTemplateDetailDto'];
export type CreateStudyPlanTemplateInput = Schemas['CreateStudyPlanTemplateDto'];
export type UpdateStudyPlanTemplateInput = Schemas['UpdateStudyPlanTemplateDto'];
export type CopyStudyPlanTemplateInput = Schemas['CopyStudyPlanTemplateDto'];
export type TemplateFromPlanInput = Schemas['FromPlanDto'];
export type FamilyStudyPlansResponse = Schemas['FamilyStudyPlansResponseDto'];
export type FamilyDayPeriod = Schemas['FamilyDayPeriodDto'];

export type StudyPlanListFilters = Query<'StudyPlansController_list_v1'>;
export type StudyPlanCapacityParams = Query<'StudyPlansController_capacity_v1'>;
export type StudyPlanProgressCsvParams = Query<'StudyPlansController_progressCsv_v1'>;
export type StudyPlanTemplateFilters = Query<'StudyPlanTemplatesController_list_v1'>;

// ---- Keys ----
export const studyPlanKeys = createEntityKeys<StudyPlanListFilters>('study-plans');
export const lessonDeliveryKeys = createEntityKeys<{ date: string }>('lesson-deliveries');
export const studyPlanTemplateKeys =
  createEntityKeys<StudyPlanTemplateFilters>('study-plan-templates');
export const familyStudyPlanKeys = createEntityKeys<{ studentId: string }>('family-study-plans');

/**
 * Plan list, plan schedule and My routine read from `study-plans` and
 * `lesson-deliveries`; every staff mutation goes through here. Family keys
 * are never touched (different users).
 */
export function invalidateStudyPlanViews(
  queryClient: QueryClient,
  roots: { plans?: boolean; deliveries?: boolean; templates?: boolean },
): void {
  if (roots.plans) void queryClient.invalidateQueries({ queryKey: studyPlanKeys.all });
  if (roots.deliveries) void queryClient.invalidateQueries({ queryKey: lessonDeliveryKeys.all });
  if (roots.templates) void queryClient.invalidateQueries({ queryKey: studyPlanTemplateKeys.all });
}

// ---- Plans ----
export function studyPlanListQueryOptions(filters: StudyPlanListFilters = {}) {
  return queryOptions({
    queryKey: studyPlanKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudyPlanListResponse>('/study-plans', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudyPlans(filters: StudyPlanListFilters = {}) {
  return useQuery(studyPlanListQueryOptions(filters));
}

export function studyPlanQueryOptions(id: string) {
  return queryOptions({
    queryKey: studyPlanKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudyPlanDetail>(`/study-plans/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudyPlan(id: string) {
  return useQuery(studyPlanQueryOptions(id));
}

export function useCreateStudyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStudyPlanInput) =>
      (await apiClient.post<StudyPlanDetail>('/study-plans', input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true }),
  });
}

/** Includes `owner_override_teacher_id`. */
export function useUpdateStudyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateStudyPlanInput }) =>
      (await apiClient.patch<StudyPlanDetail>(`/study-plans/${id}`, input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true }),
  });
}

export function useDeleteStudyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/study-plans/${id}`);
    },
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true }),
  });
}

/** `PUT /study-plans/:id/lessons` — the whole ordered list. */
export function useSaveStudyPlanLessons(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveStudyPlanLessonsInput) =>
      (await apiClient.put<StudyPlanDetail>(`/study-plans/${id}/lessons`, input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true }),
  });
}

export function studyPlanScheduleQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...studyPlanKeys.detail(id), 'schedule'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudyPlanScheduleResponse>(`/study-plans/${id}/schedule`, {
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudyPlanSchedule(id: string) {
  return useQuery(studyPlanScheduleQueryOptions(id));
}

export function useCopyStudyPlanToSection(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyStudyPlanToSectionInput) =>
      (await apiClient.post<StudyPlanDetail>(`/study-plans/${id}/copy-to-section`, input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true }),
  });
}

export function useSaveStudyPlanExamMarkers(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveStudyPlanExamMarkersInput) =>
      (await apiClient.put<StudyPlanDetail>(`/study-plans/${id}/exam-markers`, input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true }),
  });
}

export function useStudyPlanCarryOver(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...studyPlanKeys.detail(id), 'carry-over'] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudyPlanCarryOverResponse>(`/study-plans/${id}/carry-over`, { signal }))
        .data,
    retry: shouldRetryQuery,
    enabled: options.enabled ?? true,
  });
}

export function useStudyPlanCapacity(
  params: StudyPlanCapacityParams,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...studyPlanKeys.all, 'capacity', params] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudyPlanCapacityResponse>('/study-plans/capacity', { params, signal }))
        .data,
    retry: shouldRetryQuery,
    enabled: options.enabled ?? true,
  });
}

/**
 * Summary handed to `BulkUploadPreview`; `warnings` ride along beside the
 * rows (the shared `PreviewResult` only models hard errors).
 */
export type StudyPlanImportSummary = Pick<
  StudyPlanImportValidateResult,
  'rows_to_create' | 'preview' | 'warnings'
>;

/**
 * `POST /study-plans/import/validate` — multipart `file` plus target
 * fields: `class_id` + `subject_id` for a plan, `class_grade` +
 * `subject_code` for a template (D45).
 */
export function useValidateStudyPlanImport() {
  return useMutation({
    mutationFn: async ({
      file,
      target,
      onProgress,
    }: {
      file: File;
      target: Record<string, string | number>;
      onProgress?: (percent: number) => void;
    }): Promise<PreviewResult<StudyPlanImportSummary>> => {
      const formData = new FormData();
      formData.append('file', file);
      for (const [key, value] of Object.entries(target)) formData.append(key, String(value));
      try {
        const res = await apiClient.post<StudyPlanImportValidateResult>(
          '/study-plans/import/validate',
          formData,
          {
            onUploadProgress: (event) => {
              if (onProgress && event.total) {
                onProgress(Math.round((event.loaded / event.total) * 100));
              }
            },
          },
        );
        const {
          staging_id,
          expires_at,
          errors,
          hard_error_count,
          rows_to_create,
          preview,
          warnings,
        } = res.data;
        return {
          staging_id,
          expires_at,
          errors,
          hard_error_count,
          summary: { rows_to_create, preview, warnings },
        };
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
  });
}

/** Target is `plan_id`, `plan` or `template` on the input (schema shape). */
export function useCommitStudyPlanImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CommitStudyPlanImportInput): Promise<StudyPlanImportCommitResult> => {
      try {
        return (
          await apiClient.post<StudyPlanImportCommitResult>('/study-plans/import/commit', input)
        ).data;
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
    // A template target changes the template list instead of a plan.
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true, templates: true }),
  });
}

// ---- CSV downloads (bearer header rules out a plain <a href>) ----
function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

async function downloadCsv(url: string, fallback: string, params?: object): Promise<void> {
  const res = await apiClient.get<Blob>(url, { params, responseType: 'blob' });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    fallback,
  );
  const objectUrl = URL.createObjectURL(res.data);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Later tick: Safari aborts the download if revoked in the same tick.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function downloadStudyPlanLessonsCsv(id: string): Promise<void> {
  return downloadCsv(`/study-plans/${id}/lessons.csv`, 'study-plan-lessons.csv');
}

export function downloadStudyPlanProgressCsv(params: StudyPlanProgressCsvParams): Promise<void> {
  return downloadCsv('/study-plans/progress.csv', 'study-plan-progress.csv', params);
}

// ---- Deliveries ----
export function myLessonDeliveriesQueryOptions(date: string) {
  return queryOptions({
    queryKey: lessonDeliveryKeys.list({ date }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<LessonDeliveriesDay>('/lesson-deliveries', {
          params: { teacher: 'me', date },
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useMyLessonDeliveries(date: string, options: { enabled?: boolean } = {}) {
  return useQuery({ ...myLessonDeliveriesQueryOptions(date), enabled: options.enabled ?? true });
}

// A delivery change moves the schedule and behind count, so both roots go.
export function useUpsertLessonDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PutLessonDeliveryInput) =>
      (await apiClient.put<SavedLessonDelivery>('/lesson-deliveries', input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true, deliveries: true }),
  });
}

export function useMarkTodayAllTaught() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<TodayAllTaughtResponse>('/lesson-deliveries/today-all-taught')).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true, deliveries: true }),
  });
}

export function useLogExtraLesson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExtraLessonDeliveryInput) =>
      (await apiClient.post<SavedLessonDelivery>('/lesson-deliveries/extra', input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true, deliveries: true }),
  });
}

// ---- Templates ----
export function useStudyPlanTemplates(filters: StudyPlanTemplateFilters = {}) {
  return useQuery({
    queryKey: studyPlanTemplateKeys.list(filters),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudyPlanTemplateList>('/study-plan-templates', {
          params: filters,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useStudyPlanTemplate(id: string) {
  return useQuery({
    queryKey: studyPlanTemplateKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudyPlanTemplateDetail>(`/study-plan-templates/${id}`, { signal }))
        .data,
    retry: shouldRetryQuery,
  });
}

export function useCreateStudyPlanTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStudyPlanTemplateInput) =>
      (await apiClient.post<StudyPlanTemplateDetail>('/study-plan-templates', input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { templates: true }),
  });
}

export function useUpdateStudyPlanTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateStudyPlanTemplateInput }) =>
      (await apiClient.patch<StudyPlanTemplateDetail>(`/study-plan-templates/${id}`, input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { templates: true }),
  });
}

export function useDeleteStudyPlanTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/study-plan-templates/${id}`);
    },
    onSuccess: () => invalidateStudyPlanViews(queryClient, { templates: true }),
  });
}

/** Returns the new plan, so plans are invalidated too. */
export function useCopyStudyPlanTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyStudyPlanTemplateInput) =>
      (await apiClient.post<StudyPlanDetail>(`/study-plan-templates/${id}/copy`, input)).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { plans: true, templates: true }),
  });
}

export function useCreateTemplateFromPlan(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateFromPlanInput) =>
      (
        await apiClient.post<StudyPlanTemplateDetail>(
          `/study-plan-templates/from-plan/${planId}`,
          input,
        )
      ).data,
    onSuccess: () => invalidateStudyPlanViews(queryClient, { templates: true }),
  });
}

// ---- Family (read-only; `enabled` only once the id is known) ----
export function useStudentStudyPlans(studentId: string | undefined) {
  return useQuery({
    queryKey: familyStudyPlanKeys.detail(studentId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<FamilyStudyPlansResponse>(`/students/${studentId}/study-plans`, {
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
    enabled: Boolean(studentId),
  });
}

export function useStudentLessons(studentId: string | undefined, date: string) {
  return useQuery({
    queryKey: [...familyStudyPlanKeys.detail(studentId ?? ''), 'lessons', date] as const,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<FamilyDayPeriod[]>(`/students/${studentId}/lessons`, {
          params: { date },
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
    enabled: Boolean(studentId),
  });
}
