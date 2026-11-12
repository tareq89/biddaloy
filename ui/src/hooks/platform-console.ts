import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { useIdempotencyKey } from './idempotency-key';
import { clampLimit } from './platform-impersonation';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
type Page<T> = { items: T[]; nextCursor: string | null };

// Response shapes follow server/src/modules/platform-control/*/dto (the OpenAPI schema has no
// response type for these routes).
export interface PlatformUserItem {
  userId: string;
  fullName: string;
  emailMasked: string | null;
  phoneMasked: string | null;
  status: string;
  locked: boolean;
  lastLoginAt: string | null;
  memberships: { memberId: string; schoolId: string; schoolName: string; role: string }[];
}
export interface PlatformAuditItem {
  id: string;
  action: string;
  entityType: string;
  schoolName: string;
  tenantId: string | null;
  actorName: string | null;
  impersonatedByName: string | null;
  sessionId: string | null;
  at: string;
}
export interface LoginAsSessionItem {
  id: string;
  ownerId: string;
  ownerName: string;
  schoolId: string;
  schoolName: string;
  role: string;
  personName: string;
  reason: string | null;
  entryKind: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  changedCount: number;
}
export interface OpsQueue {
  name: string;
  available: boolean;
  waiting?: number;
  active?: number;
  failed?: number;
  delayed?: number;
}
export interface OpsSystem {
  appVersion: string;
  lastMigration: string | null;
  database: 'ok' | 'fail';
  redis: 'ok' | 'fail';
  restoring: {
    schoolId: string;
    schoolName: string;
    jobStatus: 'QUEUED' | 'RUNNING';
    locked: boolean;
  }[];
}
export interface Announcement {
  id: string;
  title: string;
  severity: string;
  statusFilter: string[];
  sms: boolean;
  email: boolean;
  schoolsTargeted: number;
  schoolsSucceeded: number;
  recipientCount: number;
  createdByName: string | null;
  createdAt: string;
}
export type SendAnnouncementInput = S['SendAnnouncementDto'];
export type AnnouncementPreviewInput = S['PreviewAnnouncementDto'];

export const platformUserKeys = createEntityKeys<{ q: string; limit: number }>('platform-users');
export const platformAuditKeys = createEntityKeys<Record<string, unknown>>('platform-audit');
export const platformOpsKeys = createEntityKeys('platform-ops');
export const platformAnnouncementKeys = createEntityKeys<{ limit: number; offset: number }>(
  'platform-announcements',
);

/** The server wants at least 3 characters. */
export const PLATFORM_USER_SEARCH_MIN = 3;

export function usePlatformUserSearch(q: string, limit?: number) {
  const params = { q: q.trim(), limit: clampLimit(limit) };
  return useQuery({
    queryKey: platformUserKeys.list(params),
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformUserItem[]>({ url: '/platform/users', params, signal }),
    enabled: params.q.length >= PLATFORM_USER_SEARCH_MIN,
    retry: shouldRetryQuery,
  });
}

export function useLogoutPlatformUser() {
  return useApprovedMutation(
    ({ id }: { id: string }, { headers }) =>
      cockpitRequest({ method: 'POST', url: `/platform/users/${id}/logout`, headers }),
    { approvalScope: 'platform.school_control' },
  );
}

/** Audit rows. Cursor paging only, no `offset`. */
export function usePlatformAudit(
  filters: {
    tenantId?: string;
    action?: string;
    actorId?: string;
    sessionId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  const params = { ...filters, limit: clampLimit(filters.limit) };
  return useQuery({
    queryKey: platformAuditKeys.list(params),
    queryFn: ({ signal }) =>
      cockpitRequest<Page<PlatformAuditItem>>({ url: '/platform/audit', params, signal }),
    retry: shouldRetryQuery,
  });
}

export function usePlatformAuditSessions(
  filters: {
    tenantId?: string;
    ownerId?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  const params = { ...filters, limit: clampLimit(filters.limit) };
  return useQuery({
    queryKey: platformAuditKeys.list({ sessions: true, ...params }),
    queryFn: ({ signal }) =>
      cockpitRequest<Page<LoginAsSessionItem>>({
        url: '/platform/audit/sessions',
        params,
        signal,
      }),
    retry: shouldRetryQuery,
  });
}

export function useOpsQueues() {
  return useQuery({
    queryKey: platformOpsKeys.detail('queues'),
    queryFn: ({ signal }) =>
      cockpitRequest<{ queues: OpsQueue[] }>({ url: '/platform/ops/queues', signal }),
    retry: shouldRetryQuery,
  });
}

export function useOpsSystem() {
  return useQuery({
    queryKey: platformOpsKeys.detail('system'),
    queryFn: ({ signal }) => cockpitRequest<OpsSystem>({ url: '/platform/ops/system', signal }),
    retry: shouldRetryQuery,
  });
}

/** Retry the failed jobs of one queue. Step-up code; the server needs no Idempotency-Key
 * for this route but the ticket asks for one, so one key per queue is sent. */
export function useRetryFailedQueue() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    ({ name }: { name: string }, { headers }) =>
      cockpitRequest<{ retried: number }>({
        method: 'POST',
        url: `/platform/ops/queues/${encodeURIComponent(name)}/retry-failed`,
        headers: { ...headers, 'Idempotency-Key': keyFor({ name }) },
      }),
    {
      approvalScope: 'platform.ops_action',
      onSuccess: () => {
        rotate();
        void queryClient.invalidateQueries({ queryKey: platformOpsKeys.all });
      },
    },
  );
}

export function useReleaseRestoreLock() {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    ({ schoolId }: { schoolId: string }, { headers }) =>
      cockpitRequest<{ released: boolean; failedJobs: number }>({
        method: 'POST',
        url: `/platform/ops/restore-lock/${schoolId}/release`,
        headers,
      }),
    {
      approvalScope: 'platform.ops_action',
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: platformOpsKeys.all }),
    },
  );
}

/** Announcements list. Offset paging (the server has no cursor here). */
export function useAnnouncements(params: { limit?: number; offset?: number } = {}) {
  const query = { limit: clampLimit(params.limit), offset: params.offset ?? 0 };
  return useQuery({
    queryKey: platformAnnouncementKeys.list(query),
    queryFn: ({ signal }) =>
      cockpitRequest<{ items: Announcement[]; total: number }>({
        url: '/platform/announcements',
        params: query,
        signal,
      }),
    retry: shouldRetryQuery,
  });
}

/** How many schools and people a filter reaches. No step-up. */
export function usePreviewAnnouncement() {
  return useMutation({
    mutationFn: (data: AnnouncementPreviewInput) =>
      cockpitRequest<{ schools: number; people: number }>({
        method: 'POST',
        url: '/platform/announcements/preview',
        data,
      }),
    retry: false,
  });
}

/**
 * Send to every school in the filter. Step-up code, the other owner (403 `APPROVAL_REQUESTED`,
 * see `getApprovalRequestId`) and an `Idempotency-Key` kept the same for the same body.
 */
export function useSendAnnouncement() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    ({ approvalId, ...data }: SendAnnouncementInput & { approvalId?: string }, { headers }) =>
      cockpitRequest<Announcement>({
        method: 'POST',
        url: '/platform/announcements',
        data,
        headers: {
          ...headers,
          'Idempotency-Key': keyFor(data),
          ...(approvalId ? { 'X-Platform-Approval': approvalId } : {}),
        },
      }),
    {
      approvalScope: 'platform.announce_all',
      onSuccess: () => {
        rotate();
        void queryClient.invalidateQueries({ queryKey: platformAnnouncementKeys.all });
      },
    },
  );
}
