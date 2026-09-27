import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- [34.3.1] `/programs*` hooks ----
// `ProgramDto`/`CreateProgramDto`/etc. are generated from `schema.d.ts`.
// The enrolment/achievement/student-programs *response* shapes aren't —
// those controllers (`program-enrollments.controller.ts`) never declared
// an `@ApiResponse`, so the generator left them untyped. Hand-typed here
// to match the controller/service return shapes exactly, same as
// `grading.ts`'s interim-types note for its own generator gaps.

export type Program = components['schemas']['ProgramDto'];
export type ProgramMilestone = components['schemas']['ProgramMilestoneDto'];
export type CreateProgramInput = components['schemas']['CreateProgramDto'];
export type UpdateProgramInput = components['schemas']['UpdateProgramDto'];
export type CreateMilestoneInput = components['schemas']['CreateMilestoneDto'];
export type UpdateMilestoneInput = components['schemas']['UpdateMilestoneDto'];
export type EnrolStudentsInput = components['schemas']['EnrolStudentsDto'];
export type RecordAchievementsInput = components['schemas']['RecordAchievementsDto'];
export type UpdateProgramEnrollmentInput = components['schemas']['UpdateProgramEnrollmentDto'];
export type ProgramEnrollmentStatus = UpdateProgramEnrollmentInput['status'];

export interface ProgramEnrollmentRow {
  id: string;
  status: ProgramEnrollmentStatus;
  started_on: string;
  ended_on: string | null;
  student: {
    id: string;
    full_name: string;
    roll_number: string | null;
    class_name: string | null;
    section_name: string | null;
  };
  achieved_count: number;
  milestone_total: number;
}

export interface ProgramEnrollmentStatusResult {
  id: string;
  status: ProgramEnrollmentStatus;
  started_on: string;
  ended_on: string | null;
}

export interface EnrolStudentsResult {
  created: number;
  skipped: number;
}

export interface RecordAchievementsResult {
  upserted: number;
}

export interface StudentProgramMilestone {
  id: string;
  name: string;
  sequence: number;
  achievement: {
    id: string;
    achieved_on: string;
    score: string | null;
    grade: string | null;
    remark: string | null;
  } | null;
}

export interface StudentProgramEntry {
  program: { id: string; name: string; is_active: boolean; show_on_report_card: boolean };
  enrollment: {
    id: string;
    status: ProgramEnrollmentStatus;
    started_on: string;
    ended_on: string | null;
  };
  milestones: StudentProgramMilestone[];
  achieved_count: number;
  milestone_total: number;
}

export interface ProgramListFilters {
  includeArchived?: boolean;
}

export const programKeys = createEntityKeys<ProgramListFilters>('programs');

/** [D24] `useStudentPrograms` reads/writes this same key family from both
 * the staff student tab and the parent/student portal, so a record made
 * from either surface invalidates the other. */
export function studentProgramKeys(studentId: string) {
  return ['programs', 'student', studentId] as const;
}

export function programsQueryOptions(filters: ProgramListFilters = {}) {
  return queryOptions({
    queryKey: programKeys.list(filters),
    queryFn: async () => {
      const res = await apiClient.get<Program[]>('/programs', {
        params: { include_archived: filters.includeArchived },
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function usePrograms(filters: ProgramListFilters = {}) {
  return useQuery(programsQueryOptions(filters));
}

export function programQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: programKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<Program>(`/programs/${id}`);
      return res.data;
    },
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useProgram(id: string | undefined) {
  return useQuery(programQueryOptions(id));
}

export interface ProgramEnrollmentFilters {
  status?: ProgramEnrollmentStatus;
}

export function programEnrollmentsQueryOptions(
  id: string | undefined,
  filters: ProgramEnrollmentFilters = {},
) {
  return queryOptions({
    queryKey: [...programKeys.detail(id ?? ''), 'enrollments', filters] as const,
    queryFn: async () => {
      const res = await apiClient.get<ProgramEnrollmentRow[]>(`/programs/${id}/enrollments`, {
        params: filters,
      });
      return res.data;
    },
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useProgramEnrollments(
  id: string | undefined,
  filters: ProgramEnrollmentFilters = {},
) {
  return useQuery(programEnrollmentsQueryOptions(id, filters));
}

export function studentProgramsQueryOptions(studentId: string | undefined) {
  return queryOptions({
    queryKey: studentProgramKeys(studentId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<StudentProgramEntry[]>(`/students/${studentId}/programs`);
      return res.data;
    },
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useStudentPrograms(studentId: string | undefined) {
  return useQuery(studentProgramsQueryOptions(studentId));
}

export function useCreateProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProgramInput) => {
      const res = await apiClient.post<Program>('/programs', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useUpdateProgram(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProgramInput) => {
      const res = await apiClient.patch<Program>(`/programs/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useDeleteProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/programs/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useAddMilestone(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMilestoneInput) => {
      const res = await apiClient.post<ProgramMilestone>(
        `/programs/${programId}/milestones`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export interface UpdateMilestoneVariables {
  milestoneId: string;
  input: UpdateMilestoneInput;
}

export function useUpdateMilestone(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ milestoneId, input }: UpdateMilestoneVariables) => {
      const res = await apiClient.patch<ProgramMilestone>(
        `/programs/${programId}/milestones/${milestoneId}`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useRemoveMilestone(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (milestoneId: string) => {
      await apiClient.delete(`/programs/${programId}/milestones/${milestoneId}`);
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useReorderMilestones(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (milestoneIds: string[]) => {
      const res = await apiClient.put<ProgramMilestone[]>(
        `/programs/${programId}/milestones/order`,
        {
          milestone_ids: milestoneIds,
        },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useEnrolStudents(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EnrolStudentsInput) => {
      const res = await apiClient.post<EnrolStudentsResult>(
        `/programs/${programId}/enrollments`,
        input,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
      for (const studentId of variables.student_ids) {
        void queryClient.invalidateQueries({ queryKey: studentProgramKeys(studentId) });
      }
    },
  });
}

export interface UpdateProgramEnrollmentVariables {
  enrollmentId: string;
  studentId?: string;
  input: UpdateProgramEnrollmentInput;
}

export function useUpdateProgramEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ enrollmentId, input }: UpdateProgramEnrollmentVariables) => {
      const res = await apiClient.patch<ProgramEnrollmentStatusResult>(
        `/program-enrollments/${enrollmentId}`,
        input,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: programKeys.all });
      if (variables.studentId) {
        void queryClient.invalidateQueries({ queryKey: studentProgramKeys(variables.studentId) });
      }
    },
  });
}

export interface RecordAchievementsVariables {
  programId: string;
  studentId?: string;
  input: RecordAchievementsInput;
}

interface RecordAchievementsContext {
  previous?: StudentProgramEntry[];
}

/** [D8] Optimistic tick on `useStudentPrograms`'s cache — the checklist UI
 * (staff tab and portal both read this same query, D24) ticks instantly
 * instead of waiting a round trip, and rolls back on error. Only mutates
 * the cache when `studentId` is known (the staff bulk-record surface
 * records across many students in one call and has no single student's
 * cache entry to optimistically patch). */
export function useRecordAchievements() {
  const queryClient = useQueryClient();
  return useMutation<
    RecordAchievementsResult,
    Error,
    RecordAchievementsVariables,
    RecordAchievementsContext
  >({
    mutationFn: async ({ programId, input }) => {
      const res = await apiClient.post<RecordAchievementsResult>(
        `/programs/${programId}/achievements`,
        input,
      );
      return res.data;
    },
    onMutate: async ({ studentId, input }) => {
      if (!studentId) return {};
      const key = studentProgramKeys(studentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<StudentProgramEntry[]>(key);
      if (previous) {
        const achievedOn = input.achieved_on ?? new Date().toISOString().slice(0, 10);
        queryClient.setQueryData<StudentProgramEntry[]>(
          key,
          previous.map((entry) => {
            const wasUnachieved = entry.milestones.some(
              (m) => m.id === input.milestone_id && m.achievement === null,
            );
            return {
              ...entry,
              milestones: entry.milestones.map((milestone) =>
                milestone.id === input.milestone_id
                  ? {
                      ...milestone,
                      achievement: {
                        id: milestone.achievement?.id ?? `optimistic-${milestone.id}`,
                        achieved_on: achievedOn,
                        score: input.score !== undefined ? String(input.score) : null,
                        grade: input.grade ?? null,
                        remark: input.remark ?? null,
                      },
                    }
                  : milestone,
              ),
              achieved_count: wasUnachieved ? entry.achieved_count + 1 : entry.achieved_count,
            };
          }),
        );
      }
      return previous ? { previous } : {};
    },
    onError: (_error, { studentId }, context) => {
      if (studentId && context?.previous) {
        queryClient.setQueryData(studentProgramKeys(studentId), context.previous);
      }
    },
    onSettled: (_data, _error, { programId, studentId }) => {
      void queryClient.invalidateQueries({ queryKey: programKeys.detail(programId) });
      if (studentId) {
        void queryClient.invalidateQueries({ queryKey: studentProgramKeys(studentId) });
      }
    },
  });
}

export interface RemoveAchievementVariables {
  achievementId: string;
  programId: string;
  studentId?: string;
  milestoneId?: string;
}

interface RemoveAchievementContext {
  previous?: StudentProgramEntry[];
}

/** [D8] Optimistic untick — mirror of `useRecordAchievements`'s optimism,
 * same rollback-on-error shape, and the same `programKeys.detail` +
 * `studentProgramKeys` invalidation on settle. */
export function useRemoveAchievement() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, RemoveAchievementVariables, RemoveAchievementContext>({
    mutationFn: async ({ achievementId }) => {
      await apiClient.delete(`/milestone-achievements/${achievementId}`);
    },
    retry: shouldRetryQuery,
    onMutate: async ({ studentId, milestoneId }) => {
      if (!studentId || !milestoneId) return {};
      const key = studentProgramKeys(studentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<StudentProgramEntry[]>(key);
      if (previous) {
        queryClient.setQueryData<StudentProgramEntry[]>(
          key,
          previous.map((entry) => ({
            ...entry,
            milestones: entry.milestones.map((milestone) =>
              milestone.id === milestoneId ? { ...milestone, achievement: null } : milestone,
            ),
            achieved_count: entry.milestones.some(
              (m) => m.id === milestoneId && m.achievement !== null,
            )
              ? entry.achieved_count - 1
              : entry.achieved_count,
          })),
        );
      }
      return previous ? { previous } : {};
    },
    onError: (_error, { studentId }, context) => {
      if (studentId && context?.previous) {
        queryClient.setQueryData(studentProgramKeys(studentId), context.previous);
      }
    },
    onSettled: (_data, _error, { programId, studentId }) => {
      void queryClient.invalidateQueries({ queryKey: programKeys.detail(programId) });
      if (studentId) {
        void queryClient.invalidateQueries({ queryKey: studentProgramKeys(studentId) });
      }
    },
  });
}
