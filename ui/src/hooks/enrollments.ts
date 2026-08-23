import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Enrollment = components['schemas']['Enrollment'];

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
