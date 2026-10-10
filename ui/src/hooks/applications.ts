import {
  APPLICATION_TYPES,
  ApplicationStatus,
  ApprovalScope,
  type ApplicationType,
} from '@biddaloy/shared';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import type { StatusTone } from '../components';
import type { RegionConfig } from '../i18n';
import { formatNumber } from '../utils';

import { useApprovedMutation } from './approval';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- Types (`/applications`, [52.2.1]/[52.3.x]) ----

type Schemas = components['schemas'];
export type ApplicationDto = Schemas['ApplicationDto'];
export type ApplicationListItemDto = Schemas['ApplicationListItemDto'];
export type ApplicationListDto = Schemas['ApplicationListDto'];
export type ApplicationEventDto = Schemas['ApplicationEventDto'];
export type ApplicationTagDto = Schemas['ApplicationTagDto'];
export type ApplicationAttachmentDto = Schemas['ApplicationAttachmentDto'];
export type PendingCountDto = Schemas['PendingCountDto'];
export type ApplicationReportsDto = Schemas['ApplicationReportsDto'];
export type LetterPreviewDto = Schemas['LetterPreviewDto'];
export type LetterPreviewResultDto = Schemas['LetterPreviewResultDto'];
export type CreateApplicationInput = Schemas['CreateApplicationDto'];
export type ApproveApplicationInput = Schemas['ApproveApplicationDto'];
export type BulkApproveInput = Schemas['BulkApproveDto'];
export type BulkApproveResult = Schemas['BulkApproveResultDto'];
export type ApplicationAddresseeOption = Schemas['AddresseeOptionDto'];
export type ApplicationTagOptions = Schemas['TagOptionsDto'];
export type ApplicationTagInput = Schemas['ApplicationTagInput'];

/** Status badge tone per status (D29 / A17). */
export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  [ApplicationStatus.PENDING]: 'warning',
  [ApplicationStatus.UNDER_CONSIDERATION]: 'info',
  [ApplicationStatus.APPROVED]: 'success',
  [ApplicationStatus.REJECTED]: 'danger',
  [ApplicationStatus.WITHDRAWN]: 'neutral',
  [ApplicationStatus.CANCELLED]: 'neutral',
};

export interface ApplicationFilters {
  view?: 'inbox' | 'mine' | 'all';
  type?: ApplicationType;
  status?: ApplicationStatus;
  from?: string;
  to?: string;
  class_id?: string;
  student_id?: string;
  staff_profile_id?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface ApplicationReportFilters {
  academic_year_id?: string;
  from?: string;
  to?: string;
}

/** Detail, list and pending-count all live under this prefix, so one `all` invalidation refreshes them. */
export const applicationKeys = {
  ...createEntityKeys<ApplicationFilters, string>('applications'),
  pendingCount: () => ['applications', 'pending-count'] as const,
  addressees: (studentId?: string) => ['applications', 'addressees', studentId ?? null] as const,
  tagOptions: (q: string) => ['applications', 'tag-options', q] as const,
  reports: (filters: ApplicationReportFilters) => ['applications', 'reports', filters] as const,
  letterPreview: (input: LetterPreviewDto) => ['applications', 'letter-preview', input] as const,
};

// ---- Queries ----

/** Also used by the detail route loader and the breadcrumb resolver. */
export function applicationQueryOptions(id: string) {
  return queryOptions({
    queryKey: applicationKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ApplicationDto>(`/applications/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useApplication(id: string | undefined) {
  return useQuery({ ...applicationQueryOptions(id ?? ''), enabled: id !== undefined && id !== '' });
}

export function useApplications(filters: ApplicationFilters = {}) {
  return useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ApplicationListDto>('/applications', { params: filters, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useApplicationPendingCount({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: applicationKeys.pendingCount(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PendingCountDto>('/applications/pending-count', { signal })).data,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // New applications arrive from other users: poll while the tab is visible.
    refetchInterval: 60_000,
    retry: shouldRetryQuery,
    // Shell chrome (the sidebar badge), like the trial bar: a suspended
    // school's 403 must not throw into the route boundary, which would
    // unmount the shell (and its school switcher) on every poll [15.4.2].
    throwOnError: false,
  });
}

export function useApplicationAddressees(studentId?: string) {
  return useQuery({
    queryKey: applicationKeys.addressees(studentId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<ApplicationAddresseeOption[]>('/applications/addressees', {
          params: studentId ? { student_id: studentId } : undefined,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useApplicationTagOptions(q: string) {
  return useQuery({
    queryKey: applicationKeys.tagOptions(q),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<ApplicationTagOptions>('/applications/tag-options', {
          params: { q },
          signal,
        })
      ).data,
    enabled: q.trim() !== '',
    retry: shouldRetryQuery,
  });
}

export function useApplicationReports(filters: ApplicationReportFilters = {}) {
  return useQuery({
    queryKey: applicationKeys.reports(filters),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<ApplicationReportsDto>('/applications/reports', {
          params: filters,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

/**
 * D48: the server is the only letter renderer; this just asks it. The key is the whole input,
 * so the host passes a settled (step-committed or debounced) input, not every keystroke.
 * The previous letter stays up while a new one loads.
 */
export function useApplicationLetterPreview(
  input: LetterPreviewDto,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: applicationKeys.letterPreview(input),
    queryFn: async ({ signal }) =>
      (
        await apiClient.post<LetterPreviewResultDto>('/applications/letter-preview', input, {
          signal,
        })
      ).data,
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/**
 * Saves one attachment. The route needs the bearer token and `X-Tenant-ID`, which a bare
 * `<a href>` can't send, so it goes through `apiClient` as a blob (like `backup.ts`'s downloads).
 */
export async function downloadApplicationAttachment(
  appId: string,
  attachment: Pick<ApplicationAttachmentDto, 'id' | 'file_name'>,
): Promise<void> {
  const res = await apiClient.get<Blob>(`/applications/${appId}/attachments/${attachment.id}`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.file_name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // A later tick: Safari aborts the download if it is revoked in the same one.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---- Mutations ----

/** Prefix of `leaveBalanceQueryOptions`' key (`api/leave.ts`). */
const LEAVE_BALANCE_KEY = ['leave', 'balance'] as const;

/**
 * Decision mutations answer with the fresh dto: seed the detail, refresh lists + badge only
 * (not the detail just seeded, nor letter-preview / reports / tag-options).
 */
function useDecisionCache() {
  const queryClient = useQueryClient();
  return (dto: ApplicationDto) => {
    queryClient.setQueryData(applicationKeys.detail(dto.id), dto);
    void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: applicationKeys.pendingCount() });
  };
}

export function useSubmitApplication() {
  const onDecided = useDecisionCache();
  return useMutation({
    mutationFn: async (input: CreateApplicationInput) =>
      (await apiClient.post<ApplicationDto>('/applications', input)).data,
    onSuccess: onDecided,
  });
}

export function useWithdrawApplication() {
  const onDecided = useDecisionCache();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<ApplicationDto>(`/applications/${id}/withdraw`)).data,
    onSuccess: onDecided,
  });
}

export function useCommentOnApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) =>
      (await apiClient.post<ApplicationEventDto>(`/applications/${id}/comments`, { note })).data,
    onSuccess: (_event, { id }) => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(id) });
    },
  });
}

export function useTagApplication() {
  const onDecided = useDecisionCache();
  return useMutation({
    mutationFn: async ({ id, tags }: { id: string; tags: ApplicationTagInput[] }) =>
      (await apiClient.post<ApplicationDto>(`/applications/${id}/tags`, { tags })).data,
    onSuccess: onDecided,
  });
}

export function useUploadApplicationAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, files }: { id: string; files: File[] }) => {
      const formData = new FormData();
      for (const file of files) formData.append('files', file);
      return (
        await apiClient.post<ApplicationAttachmentDto[]>(
          `/applications/${id}/attachments`,
          formData,
        )
      ).data;
    },
    onSuccess: (_attachments, { id }) => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(id) });
    },
  });
}

export function useDeleteApplicationAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, attachmentId }: { id: string; attachmentId: string }) => {
      await apiClient.delete(`/applications/${id}/attachments/${attachmentId}`);
    },
    onSuccess: (_void, { id }) => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(id) });
    },
  });
}

export function useRejectApplication() {
  const onDecided = useDecisionCache();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await apiClient.post<ApplicationDto>(`/applications/${id}/reject`, { reason })).data,
    onSuccess: onDecided,
  });
}

export function useConsiderApplication() {
  const onDecided = useDecisionCache();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) =>
      (await apiClient.post<ApplicationDto>(`/applications/${id}/consider`, { note })).data,
    onSuccess: onDecided,
  });
}

export function useCancelApplication() {
  const onDecided = useDecisionCache();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await apiClient.post<ApplicationDto>(`/applications/${id}/cancel`, { reason })).data,
    onSuccess: (dto) => {
      onDecided(dto);
      // Cancelling an approved STAFF_LEAVE reverses its ledger rows: the balance is stale too.
      if (dto.type === 'STAFF_LEAVE')
        void queryClient.invalidateQueries({ queryKey: LEAVE_BALANCE_KEY });
    },
  });
}

export function useBulkApproveApplications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkApproveInput) =>
      (await apiClient.post<BulkApproveResult[]>('/applications/bulk-approve', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.all });
      void queryClient.invalidateQueries({ queryKey: LEAVE_BALANCE_KEY });
    },
  });
}

/**
 * Only a FEE_WAIVER final step answers `APPROVAL_REQUIRED` (discount_rules.manage step-up);
 * for every other type the approval wrapper is a no-op.
 */
export function useApproveApplication() {
  const onDecided = useDecisionCache();
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async (input: { id: string } & ApproveApplicationInput, options) => {
      const { id, ...body } = input;
      return (await apiClient.post<ApplicationDto>(`/applications/${id}/approve`, body, options))
        .data;
    },
    {
      approvalScope: ApprovalScope.DISCOUNT_RULES_MANAGE,
      retry: false,
      onSuccess: (dto: ApplicationDto) => {
        onDecided(dto);
        // An approved STAFF_LEAVE writes the ledger: the balance shown elsewhere is now stale.
        if (dto.type === 'STAFF_LEAVE')
          void queryClient.invalidateQueries({ queryKey: LEAVE_BALANCE_KEY });
      },
    },
  );
}

// ---- Labels ----

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "ধাপ ১/২ · শ্রেণি শিক্ষক": the step the application waits at, named by its approver.
 * Pass any `t`; the namespace is named per call.
 */
export function stepLabel(
  app: Pick<ApplicationListItemDto, 'type' | 'current_step' | 'step_count' | 'addressee_name'>,
  t: Translate,
  config: RegionConfig,
): string {
  const steps = APPLICATION_TYPES[app.type as ApplicationType].steps;
  const step = steps[Math.min(app.current_step, steps.length - 1)];
  const key = !step
    ? 'ADDRESSEE'
    : step.kind === 'PERMISSION'
      ? `PERMISSION_${step.permission}`
      : step.kind === 'ROLES'
        ? `ROLES_${step.roles[0]}`
        : step.kind;
  return t('stepOf', {
    ns: 'applications',
    current: formatNumber(Math.min(app.current_step + 1, app.step_count), config),
    total: formatNumber(app.step_count, config),
    label: t(`steps.${key}`, { ns: 'applications', name: app.addressee_name ?? '' }),
  });
}
