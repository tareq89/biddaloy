import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { platformHistoryKeys } from './platform-owners';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type PlatformApproval = {
  id: string;
  scope: string;
  summary: Record<string, unknown>;
  status: 'PENDING' | 'GRANTED' | 'DENIED' | 'USED' | 'EXPIRED';
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
};
export type PlatformApprovalSetting = components['schemas']['PlatformApprovalSettingDto'];

export const platformApprovalKeys = createEntityKeys<{ status?: PlatformApproval['status'] }>(
  'platform-approvals',
);
export const approvalsSettingKeys = createEntityKeys('platform-approvals-setting');

/**
 * A two-person action answers 403 `{ details: { code: 'APPROVAL_REQUESTED', requestId } }`
 * when the other owner has to agree first. Returns that `requestId` (so the page can say
 * "waiting for the other owner"), or null for any other error.
 */
export function getApprovalRequestId(error: unknown): string | null {
  const e = error as { statusCode?: number; details?: { code?: unknown; requestId?: unknown } };
  return e?.statusCode === 403 &&
    e.details?.code === 'APPROVAL_REQUESTED' &&
    typeof e.details.requestId === 'string'
    ? e.details.requestId
    : null;
}

export function usePlatformApprovals(params: { status?: PlatformApproval['status'] } = {}) {
  return useQuery({
    queryKey: platformApprovalKeys.list(params),
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformApproval[]>({ url: '/platform/approvals', params, signal }),
    retry: shouldRetryQuery,
  });
}

/** Approve or deny another owner's request. Asks for an authenticator code first. */
export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    ({ id, decision }: { id: string; decision: 'approve' | 'deny' }, { headers }) =>
      cockpitRequest({ method: 'POST', url: `/platform/approvals/${id}/${decision}`, headers }),
    {
      approvalScope: 'platform.approval_decide',
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: platformApprovalKeys.all });
        void queryClient.invalidateQueries({ queryKey: platformHistoryKeys.all });
      },
    },
  );
}

export function useApprovalsSetting() {
  return useQuery({
    queryKey: approvalsSettingKeys.all,
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformApprovalSetting>({ url: '/platform/settings/approvals', signal }),
    retry: shouldRetryQuery,
  });
}

/**
 * Turning it OFF also needs the other owner: the first try fails with `APPROVAL_REQUESTED`
 * (see `getApprovalRequestId`); once they approve, call again with that `approvalId`.
 */
export function useSetApprovalsSetting() {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    ({ enabled, approvalId }: { enabled: boolean; approvalId?: string }, { headers }) =>
      cockpitRequest<PlatformApprovalSetting>({
        method: 'PATCH',
        url: '/platform/settings/approvals',
        data: { enabled },
        headers: { ...headers, ...(approvalId ? { 'X-Platform-Approval': approvalId } : {}) },
      }),
    {
      approvalScope: 'platform.approvals_switch',
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: approvalsSettingKeys.all });
        void queryClient.invalidateQueries({ queryKey: platformApprovalKeys.all });
      },
    },
  );
}
