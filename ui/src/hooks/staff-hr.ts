import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [23.9] client types for [23.2]'s `staff-hr-records`/`designations`
 * endpoints. `schema.d.ts` hasn't been regenerated for these routes yet
 * (23.2 merged after the last `generate:api-types` run), so these are
 * hand-typed from the actual entities/DTOs
 * (`server/src/modules/staff-hr/entities/*.entity.ts`,
 * `server/src/modules/staff-hr/dto/staff-hr-record.dto.ts`) rather than
 * `components['schemas'][...]`. Replace with the generated types once
 * `schema.d.ts` catches up — field names here already match the server's
 * actual response shape, so that swap should be a type-only change.
 */
export interface StaffHrRecord {
  id: string;
  user_id: string;
  index_no: string | null;
  salary_code: string | null;
  mpo_date: string | null;
  salary_scale: string | null;
  department: string | null;
  blood_group: string | null;
  religion: string | null;
  created_at: string;
  updated_at: string;
}

export type StaffEmploymentStatus = 'REGULAR' | 'IRREGULAR' | 'RESIGNED';

export interface StaffDesignationHistory {
  id: string;
  user_id: string;
  designation_id: string;
  effective_date: string;
  end_date: string | null;
  status: StaffEmploymentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Designation {
  id: string;
  title_en: string;
  title_bn: string | null;
  is_teaching: boolean;
}

export interface CreateStaffHrRecordInput {
  user_id: string;
  index_no?: string;
  salary_code?: string;
  mpo_date?: string;
  salary_scale?: string;
  department?: string;
  blood_group?: string;
  religion?: string;
}

export type UpdateStaffHrRecordInput = Omit<CreateStaffHrRecordInput, 'user_id'>;

export interface PromoteStaffInput {
  designation_id: string;
  effective_date: string;
  notes?: string;
}

export const staffHrRecordKeys = createEntityKeys<{ user_id?: string }>('staff-hr-records');
export const designationHistoryKeys = createEntityKeys<{ user_id: string }>(
  'staff-designation-history',
);
export const designationKeys = createEntityKeys('designations');

/** One user's HR record, if one exists yet — [23.9]'s job-info section.
 * `GET /staff-hr-records` has no single-record-by-user route, so this
 * filters server-side with `user_id` (same shape as `useTeachers`'s
 * `user_id` filter) and takes the one row a tenant-scoped unique index
 * guarantees is at most one. */
export function staffHrRecordQueryOptions(userId: string) {
  return queryOptions({
    queryKey: staffHrRecordKeys.list({ user_id: userId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffHrRecord[]>('/staff-hr-records', {
        params: { user_id: userId },
        signal,
      });
      return res.data[0] ?? null;
    },
    retry: shouldRetryQuery,
  });
}

export function useStaffHrRecord(userId: string) {
  return useQuery(staffHrRecordQueryOptions(userId));
}

/** Every designation-history row for one user, newest first — [23.9]'s
 * promotion timeline. */
export function staffDesignationHistoryQueryOptions(userId: string) {
  return queryOptions({
    queryKey: designationHistoryKeys.list({ user_id: userId }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffDesignationHistory[]>(
        `/staff-hr-records/${userId}/designation-history`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStaffDesignationHistory(userId: string) {
  return useQuery(staffDesignationHistoryQueryOptions(userId));
}

/** The tenant's designation (job title) list — needed to label a history
 * row's `designation_id` and to populate the promote dialog's picker.
 * Small, tenant-wide, no pagination needed (same "whole list fits one
 * page" reasoning as `teachers.ts`'s `TEACHER_FILTER_LIMIT`). */
export function designationsQueryOptions() {
  return queryOptions({
    queryKey: designationKeys.lists(),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Designation[]>('/designations', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useDesignations() {
  return useQuery(designationsQueryOptions());
}

export function useCreateStaffHrRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStaffHrRecordInput) => {
      const res = await apiClient.post<StaffHrRecord>('/staff-hr-records', input);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: staffHrRecordKeys.list({ user_id: variables.user_id }),
      });
    },
  });
}

export function useUpdateStaffHrRecord(id: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateStaffHrRecordInput) => {
      const res = await apiClient.patch<StaffHrRecord>(`/staff-hr-records/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: staffHrRecordKeys.list({ user_id: userId }),
      });
    },
  });
}

/** [23.2]'s atomic close-then-insert promotion (D7). */
export function usePromoteStaff(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoteStaffInput) => {
      const res = await apiClient.post<StaffDesignationHistory>(
        `/staff-hr-records/${userId}/promote`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: designationHistoryKeys.list({ user_id: userId }),
      });
    },
  });
}
