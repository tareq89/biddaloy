import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { studentKeys } from './students';

export type Enrollment = components['schemas']['Enrollment'];
export type CreateEnrollmentInput = components['schemas']['CreateEnrollmentDto'];
export type UpdateEnrollmentInput = components['schemas']['UpdateEnrollmentDto'];

export const enrollmentKeys = createEntityKeys<{ studentId: string }>('enrollments');

/** [8.10.2]'s Enrollment tab — every enrolment record for one student
 * (current and historical), newest first. There's no tenant-wide
 * enrolments list to speak of (`EnrollmentController` only exposes
 * `create`/`findByStudent`/`update`), so this is the entity's only read
 * query — no `enrollmentsQueryOptions(filters)` counterpart to build. */
export function useStudentEnrollments(studentId: string) {
  return useQuery(
    queryOptions({
      queryKey: enrollmentKeys.list({ studentId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<Enrollment[]>(`/enrollments/student/${studentId}`, {
          signal,
        });
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

/** [8.11.3] — the "Move class" dialog's starting point: the student's
 * current (ACTIVE) enrollment, or `null` for a legacy student created
 * before this issue's `StudentService.create` day-one enrollment write
 * (see `EnrollmentController.findCurrent`'s own comment). Keyed as this
 * entity's `detail(studentId)` — "the student's current enrollment" is a
 * natural fit for that branch, and it's what a class/section move
 * invalidates below alongside the history list. `EnrollmentController.findCurrent`
 * carries an explicit `@ApiOkResponse` for the nullable case, so
 * `schema.d.ts` already types this operation's response as
 * `Enrollment | null` — the generic below matches it, not a hand-rolled
 * guess. */
export function useCurrentEnrollment(studentId: string) {
  return useQuery(
    queryOptions({
      queryKey: enrollmentKeys.detail(studentId),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<Enrollment | null>(`/enrollments/${studentId}/current`, {
          signal,
        });
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

/** [8.11.3] — the "Move class" dialog's get-or-create fallback: a legacy
 * student with no `Enrollment` row yet (`useCurrentEnrollment` resolves
 * `null`) gets a fresh one POSTed instead of an existing one PATCHed —
 * same end state (`EnrollmentService.create`'s sync-on-ACTIVE side
 * effect moves `Student.class_section_id` exactly like `update`'s does).
 * Not optimistic — same reasoning as `useUpdateStudentEnrollmentStatus`: a
 * real class move is a deliberate form-submit the staff member is
 * already waiting on, not a background preference flip; a rolled-back
 * transfer must never show the student in a class they didn't actually
 * move to. */
export function useCreateEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEnrollmentInput) => {
      const res = await apiClient.post<Enrollment>('/enrollments', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: (enrollment) => {
      void queryClient.invalidateQueries({
        queryKey: enrollmentKeys.list({ studentId: enrollment.student_id }),
      });
      void queryClient.invalidateQueries({
        queryKey: enrollmentKeys.detail(enrollment.student_id),
      });
      // A move changes `Student.class_section_id`/`roll_number` too — the
      // student detail header and every list column reading them.
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(enrollment.student_id) });
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
    },
  });
}

/** [8.11.3] — the "Move class" dialog's primary path: `PATCH` an existing
 * enrollment row (`class_id`/`section_id`/`enrollment_status`). Same
 * non-optimistic reasoning and invalidation shape as
 * `useCreateEnrollment` above. */
export function useUpdateEnrollment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateEnrollmentInput) => {
      const res = await apiClient.patch<Enrollment>(`/enrollments/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: (enrollment) => {
      void queryClient.invalidateQueries({
        queryKey: enrollmentKeys.list({ studentId: enrollment.student_id }),
      });
      void queryClient.invalidateQueries({
        queryKey: enrollmentKeys.detail(enrollment.student_id),
      });
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(enrollment.student_id) });
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
    },
  });
}
