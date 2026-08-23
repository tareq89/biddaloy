import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type CommunicationLog = components['schemas']['CommunicationResponseDto'];

export const communicationLogKeys = createEntityKeys<{ studentId: string }>('communication-logs');

/** [8.10.2]'s Communication tab — read-only message history for one
 * student. Distinct file from `reminders.ts`, which is the *write* side
 * (the bulk-send mutation `/students`'s list page fires) — this is the
 * read side neither that file nor `students.ts` has any reason to own. */
export function useStudentCommunicationLogs(studentId: string) {
  return useQuery(
    queryOptions({
      queryKey: communicationLogKeys.list({ studentId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<CommunicationLog[]>(
          `/communications/student/${studentId}`,
          { signal },
        );
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}
