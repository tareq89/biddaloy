import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { clampLimit } from './platform-impersonation';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type PlatformSchoolSearchItem = S['PlatformSchoolSearchItemDto'];
export type PlatformSchoolSearchPage = S['PlatformSchoolSearchPageDto'];
export type SchoolOverview = S['SchoolOverviewDto'];
export type SchoolNote = S['SchoolNoteResponseDto'];
export type SchoolRenameResult = S['SchoolRenameResponseDto'];
export type ArchiveExportStatus = S['ArchiveExportStatusDto'];
export type ArchiveSchoolResult = S['ArchiveSchoolResponseDto'];
export type AdminResetLinkResult = { channel: 'SMS' | 'EMAIL'; expiresAt: string };
export type LogoutAllResult = S['LogoutAllResponseDto'];

export interface SchoolListFilters {
  status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  trial?: 'active' | 'expired';
  q?: string;
  sort?: 'lastActivity' | 'students' | 'trialEnd' | 'name';
  page?: number;
  limit?: number;
}

export const schoolControlKeys = createEntityKeys<SchoolListFilters>('platform-school-control');
export const schoolNotesKeys = createEntityKeys('platform-school-notes');

const SCOPE = { approvalScope: 'platform.school_control' };

export function usePlatformSchoolList(filters: SchoolListFilters = {}) {
  const params = { ...filters, limit: clampLimit(filters.limit) };
  return useQuery({
    queryKey: schoolControlKeys.list(params),
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformSchoolSearchPage>({
        url: '/platform/schools/search',
        params,
        signal,
      }),
    retry: shouldRetryQuery,
  });
}

export function useSchoolOverview(schoolId: string | undefined) {
  return useQuery({
    queryKey: schoolControlKeys.detail(schoolId ?? ''),
    queryFn: ({ signal }) =>
      cockpitRequest<SchoolOverview>({ url: `/platform/schools/${schoolId}/overview`, signal }),
    enabled: !!schoolId,
    retry: shouldRetryQuery,
  });
}

export function useSchoolNotes(schoolId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: schoolNotesKeys.detail(`${schoolId}:${limit ?? ''}`),
    queryFn: ({ signal }) =>
      cockpitRequest<SchoolNote[]>({
        url: `/platform/schools/${schoolId}/notes`,
        params: { limit: clampLimit(limit) },
        signal,
      }),
    enabled: !!schoolId,
    retry: shouldRetryQuery,
  });
}

export function useAddSchoolNote(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ text }: { text: string }) =>
      cockpitRequest<SchoolNote>({
        method: 'POST',
        url: `/platform/schools/${schoolId}/notes`,
        data: { text },
      }),
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: schoolNotesKeys.all }),
  });
}

export function useDeleteSchoolNote(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId }: { noteId: string }) =>
      cockpitRequest({ method: 'DELETE', url: `/platform/schools/${schoolId}/notes/${noteId}` }),
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: schoolNotesKeys.all }),
  });
}

/** Sign out everyone of one school. Step-up code. */
export function useLogoutAllSchool(schoolId: string) {
  return useApprovedMutation(
    (_: void, { headers }) =>
      cockpitRequest<LogoutAllResult>({
        method: 'POST',
        url: `/platform/schools/${schoolId}/logout-all`,
        headers,
      }),
    SCOPE,
  );
}

/** Send a school admin a password reset link. Step-up code. */
export function useSendAdminResetLink(schoolId: string) {
  return useApprovedMutation(
    ({ userId }: { userId: string }, { headers }) =>
      cockpitRequest<AdminResetLinkResult>({
        method: 'POST',
        url: `/platform/schools/${schoolId}/admins/${userId}/reset-link`,
        headers,
      }),
    SCOPE,
  );
}

export function useRenameSchool(schoolId: string) {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    (data: { name?: string; name_bn?: string | null; reason: string }, { headers }) =>
      cockpitRequest<SchoolRenameResult>({
        method: 'PATCH',
        url: `/platform/schools/${schoolId}/name`,
        data,
        headers,
      }),
    {
      ...SCOPE,
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: schoolControlKeys.all }),
    },
  );
}

export function useStartArchiveExport(schoolId: string) {
  return useMutation({
    mutationFn: () =>
      cockpitRequest<{ jobId: string }>({
        method: 'POST',
        url: `/platform/schools/${schoolId}/archive/export`,
      }),
    retry: false,
  });
}

/** Polls while the export is not finished. */
export function useArchiveExportStatus(schoolId: string, jobId: string | undefined) {
  return useQuery({
    queryKey: ['platform-archive-export', schoolId, jobId],
    queryFn: ({ signal }) =>
      cockpitRequest<ArchiveExportStatus>({
        url: `/platform/schools/${schoolId}/archive/export/${jobId}`,
        signal,
      }),
    enabled: !!jobId,
    refetchInterval: (q) =>
      q.state.data?.status === 'QUEUED' || q.state.data?.status === 'RUNNING' ? 3000 : false,
    retry: shouldRetryQuery,
  });
}

/** Archive (suspend) a school once its export is done. Step-up code. */
export function useArchiveSchool(schoolId: string) {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    (data: { exportJobId: string; reason: string }, { headers }) =>
      cockpitRequest<ArchiveSchoolResult>({
        method: 'POST',
        url: `/platform/schools/${schoolId}/archive`,
        data,
        headers,
      }),
    {
      ...SCOPE,
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: schoolControlKeys.all }),
    },
  );
}
