import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type LifecycleReport = components['schemas']['LifecycleReportDto'];
export type LifecycleReportRow = components['schemas']['LifecycleReportRowDto'];
export type LifecycleReportCounts = components['schemas']['LifecycleReportCountsDto'];
export interface LifecycleReportFilters {
  academicYearId: string;
  classId?: string;
}

export const admissionReportKeys = createEntityKeys<LifecycleReportFilters>('admission-reports');

/** [39.4.1] `GET /admission/reports/lifecycle` — the admissions/leavers
 * report. Waits for an academic year (the API requires one). */
export function useAdmissionLifecycleReport({ academicYearId, classId }: LifecycleReportFilters) {
  return useQuery({
    queryKey: admissionReportKeys.list({ academicYearId, ...(classId ? { classId } : {}) }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<LifecycleReport>('/admission/reports/lifecycle', {
        params: { academic_year_id: academicYearId, ...(classId ? { class_id: classId } : {}) },
        signal,
      });
      return res.data;
    },
    enabled: Boolean(academicYearId),
    retry: shouldRetryQuery,
  });
}
