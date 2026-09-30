import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { enrollmentKeys } from './enrollments';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { studentKeys, type Student } from './students';

// [39.3.1] Student-side hooks for Epic 39.0: lifecycle events (leave /
// readmit), staff-only notes, public exams. Types come straight from the
// generated schema.

export type StudentLifecycleEvent = components['schemas']['StudentLifecycleEventDto'];
export type LeaveStudentInput = components['schemas']['LeaveStudentDto'];
export type ReadmitStudentInput = components['schemas']['ReadmitStudentDto'];
export type UpdateStudentRecordsInput = components['schemas']['UpdateStudentRecordsDto'];
export type StudentNote = components['schemas']['StudentNoteResponseDto'];
export type CreateStudentNoteInput = components['schemas']['CreateStudentNoteDto'];
export type StudentPublicExam = components['schemas']['StudentPublicExam'];
export type CreateStudentPublicExamInput = components['schemas']['CreateStudentPublicExamDto'];
export type UpdateStudentPublicExamInput = components['schemas']['UpdateStudentPublicExamDto'];
/** `examId` present -> PATCH that row, absent -> POST a new one. */
export type SavePublicExamInput = (CreateStudentPublicExamInput | UpdateStudentPublicExamInput) & {
  examId?: string;
};

export const lifecycleEventKeys = createEntityKeys<{ studentId: string }>(
  'student-lifecycle-events',
);
export const studentNoteKeys = createEntityKeys<{ studentId: string }>('student-notes');
export const studentPublicExamKeys = createEntityKeys<{ studentId: string }>(
  'student-public-exams',
);

// ---- Lifecycle events ----

export function useLifecycleEvents(studentId: string) {
  return useQuery({
    queryKey: lifecycleEventKeys.list({ studentId }),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudentLifecycleEvent[]>(`/students/${studentId}/lifecycle-events`, {
          signal,
        })
      ).data,
    enabled: Boolean(studentId),
    retry: shouldRetryQuery,
  });
}

/** Leaving/readmitting flips the student's status and enrollment, so the
 * detail, the enrollment history/current, the student lists and the event
 * timeline are all stale afterwards. */
function invalidateAfterLifecycleChange(queryClient: QueryClient, studentId: string) {
  void queryClient.invalidateQueries({ queryKey: studentKeys.detail(studentId) });
  void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: enrollmentKeys.all });
  void queryClient.invalidateQueries({ queryKey: lifecycleEventKeys.list({ studentId }) });
}

export function useLeaveStudent(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeaveStudentInput) =>
      (await apiClient.post<StudentLifecycleEvent>(`/students/${studentId}/leave`, input)).data,
    onSuccess: () => invalidateAfterLifecycleChange(queryClient, studentId),
  });
}

export function useReadmitStudent(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReadmitStudentInput) =>
      (await apiClient.post<StudentLifecycleEvent>(`/students/${studentId}/readmit`, input)).data,
    onSuccess: () => invalidateAfterLifecycleChange(queryClient, studentId),
  });
}

/** [39.2.4] The Records tab's save: `PATCH /students/:id/records`. Its own route, not
 * `useUpdateStudent`, because an EXECUTIVE holds STUDENT_RECORDS_WRITE but not the general
 * STUDENT_UPDATE that `PATCH /students/:id` needs. Sends only the five profile fields. */
export function useUpdateStudentRecords(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateStudentRecordsInput) =>
      (await apiClient.patch<Student>(`/students/${studentId}/records`, input)).data,
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(studentId) });
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
    },
  });
}

// ---- Notes (staff-only, D4) ----

export function useStudentNotes(studentId: string) {
  return useQuery({
    queryKey: studentNoteKeys.list({ studentId }),
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudentNote[]>(`/students/${studentId}/notes`, { signal })).data,
    enabled: Boolean(studentId),
    retry: shouldRetryQuery,
  });
}

export function useAddStudentNote(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStudentNoteInput) =>
      (await apiClient.post<StudentNote>(`/students/${studentId}/notes`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentNoteKeys.list({ studentId }) });
    },
  });
}

export function useDeleteStudentNote(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => {
      await apiClient.delete<void>(`/students/${studentId}/notes/${noteId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentNoteKeys.list({ studentId }) });
    },
  });
}

// ---- Public exams ----

export function usePublicExams(studentId: string) {
  return useQuery({
    queryKey: studentPublicExamKeys.list({ studentId }),
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudentPublicExam[]>(`/students/${studentId}/public-exams`, { signal }))
        .data,
    enabled: Boolean(studentId),
    retry: shouldRetryQuery,
  });
}

export function useSavePublicExam(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ examId, ...body }: SavePublicExamInput) =>
      examId
        ? (
            await apiClient.patch<StudentPublicExam>(
              `/students/${studentId}/public-exams/${examId}`,
              body,
            )
          ).data
        : (await apiClient.post<StudentPublicExam>(`/students/${studentId}/public-exams`, body))
            .data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentPublicExamKeys.list({ studentId }) });
    },
  });
}

export function useDeletePublicExam(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (examId: string) => {
      await apiClient.delete<void>(`/students/${studentId}/public-exams/${examId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentPublicExamKeys.list({ studentId }) });
    },
  });
}
