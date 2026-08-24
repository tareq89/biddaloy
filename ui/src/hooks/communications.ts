import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type CommunicationLog = components['schemas']['CommunicationResponseDto'];

export const communicationLogKeys = createEntityKeys<
  { studentId: string } | { guardianId: string }
>('communication-logs');

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

/** [8.11.4]'s Communication History tab — read-only message history for
 * one guardian, direct mirror of `useStudentCommunicationLogs` above,
 * backed by `communications.controller.ts`'s `GET
 * communications/guardian/:guardianId`. */
export function useGuardianCommunicationLogs(guardianId: string) {
  return useQuery(
    queryOptions({
      queryKey: communicationLogKeys.list({ guardianId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<CommunicationLog[]>(
          `/communications/guardian/${guardianId}`,
          { signal },
        );
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

export type LastReminder = components['schemas']['LastReminderDto'];

/** [8.10.4]'s dues queue "Last reminder" column — one batch request for a
 * page's worth of students instead of one per row. Disabled when
 * `studentIds` is empty, since `GET /communications/last-reminders`
 * requires at least one id and an empty page shouldn't fire it. */
export function useLastReminders(studentIds: string[]) {
  return useQuery(
    queryOptions({
      queryKey: [...communicationLogKeys.all, 'last-reminders', [...studentIds].sort()] as const,
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<LastReminder[]>('/communications/last-reminders', {
          params: { student_ids: studentIds.join(',') },
          signal,
        });
        return new Map(res.data.map((reminder) => [reminder.student_id, reminder]));
      },
      enabled: studentIds.length > 0,
      retry: shouldRetryQuery,
    }),
  );
}
