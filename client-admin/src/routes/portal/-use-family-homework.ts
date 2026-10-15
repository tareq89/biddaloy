/**
 * [8.10.7.5.10] The family homework list (`GET /students/:id/homework`, 4-14):
 * the server checks the guardian link, so only a linked child resolves. Shared
 * by the portal homework page and the portal homework card.
 */
import { apiClient } from '@biddaloy/ui/api';
import type { components } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { queryOptions, useQuery } from '@tanstack/react-query';

export type FamilyHomeworkList = components['schemas']['FamilyHomeworkListDto'];

export function familyHomeworkQueryOptions(studentId: string | undefined) {
  return queryOptions({
    queryKey: ['students', studentId, 'homework'] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<FamilyHomeworkList>(`/students/${studentId}/homework`, { signal })).data,
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useFamilyHomework(studentId: string | undefined) {
  return useQuery(familyHomeworkQueryOptions(studentId));
}
