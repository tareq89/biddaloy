import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { shouldRetryQuery } from './retry';

// [28.4.1] Read-only rollups, `GET /performance/{students,classes,staff}/:id`.
export type StudentPerformance = components['schemas']['StudentPerformanceResponseDto'];
export type ClassPerformance = components['schemas']['ClassPerformanceResponseDto'];
export type StaffPerformance = components['schemas']['StaffPerformanceResponseDto'];

export interface PerformanceScope {
  academicYearId: string;
  termId?: string;
}

const performanceKey = ['performance'] as const;

export function studentPerformanceQueryOptions(studentId: string, scope: PerformanceScope) {
  return queryOptions({
    queryKey: [...performanceKey, 'student', studentId, scope] as const,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudentPerformance>(`/performance/students/${studentId}`, {
          params: scope,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function classPerformanceQueryOptions(
  classId: string,
  scope: PerformanceScope & { sectionId?: string },
) {
  return queryOptions({
    queryKey: [...performanceKey, 'class', classId, scope] as const,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<ClassPerformance>(`/performance/classes/${classId}`, {
          params: scope,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function staffPerformanceQueryOptions(userId: string) {
  return queryOptions({
    queryKey: [...performanceKey, 'staff', userId] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<StaffPerformance>(`/performance/staff/${userId}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export const useStudentPerformance = (studentId: string, scope: PerformanceScope) =>
  useQuery(studentPerformanceQueryOptions(studentId, scope));
export const useClassPerformance = (
  classId: string,
  scope: PerformanceScope & { sectionId?: string },
) => useQuery(classPerformanceQueryOptions(classId, scope));
export const useStaffPerformance = (userId: string) =>
  useQuery(staffPerformanceQueryOptions(userId));
