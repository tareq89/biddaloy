import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { userKeys } from './users';

/**
 * [12.6] Preview-first batch provisioning of guardian accounts. Mirrors
 * `reminders.ts`'s `useBulkReminderPreview`/`useSendBulkReminder`/
 * `reminderBatchQueryOptions` shape — same preview → dispatch → poll grammar,
 * but the server tracks progress from `communication_logs`/`auth_tokens`
 * `metadata.batch_id` rather than a `ReminderBatch` row, so there is no
 * `GET .../bulk` list endpoint here, only the one batch-status route.
 *
 * `POST /users/invitations/preview`'s and `.../batch`'s bodies are
 * untyped in `schema.d.ts` (same gap `guardians.ts`'s `PaginatedGuardians`
 * documents) — hand-typed against `BatchInviteDto` /
 * `InvitePreviewResponseDto` / `InviteDispatchResponseDto` /
 * `InviteBatchStatusResponseDto` (`server/src/modules/account-access/dto/batch-invite.dto.ts`).
 */
export interface BatchInviteSelection {
  guardian_ids?: string[];
  student_ids?: string[];
  all?: boolean;
}

export type InviteChannel = 'SMS' | 'EMAIL';
export type InviteSkipReason =
  'no_contact' | 'already_active' | 'already_pending' | 'notifications_disabled';

export interface InvitePreviewEntry {
  guardian_id: string;
  full_name: string;
  channel: InviteChannel;
  user_exists: boolean;
}

export interface InviteSkippedEntry {
  guardian_id: string;
  full_name: string;
  reason: InviteSkipReason;
}

export interface InvitePreviewResult {
  total: number;
  to_invite: InvitePreviewEntry[];
  skipped: InviteSkippedEntry[];
}

export interface InviteDispatchResult {
  batch_id: string;
  queued: number;
  skipped: InviteSkippedEntry[];
}

export interface InviteBatchStatus {
  batch_id: string;
  total: number;
  sent: number;
  failed: number;
  queued: number;
}

const invitationBatchKeys = createEntityKeys<never, string>('invitation-batches');

/** No cache — a preview is always re-run right before a dispatch decision
 * and must reflect the live state of every guardian in the selection. */
export function useInvitationPreview() {
  return useMutation({
    mutationFn: async (selection: BatchInviteSelection) => {
      const res = await apiClient.post<InvitePreviewResult>(
        '/users/invitations/preview',
        selection,
      );
      return res.data;
    },
    retry: false,
  });
}

/** Not `shouldRetryQuery` — like `useSendBulkReminder`, a retry after a
 * dropped response would provision/queue a second batch for the same
 * guardians. */
export function useDispatchInvitations() {
  return useMutation({
    mutationFn: async (selection: BatchInviteSelection) => {
      const res = await apiClient.post<InviteDispatchResult>('/users/invitations/batch', selection);
      return res.data;
    },
    retry: false,
  });
}

const INVITATION_BATCH_POLL_MS = 2000;

/** Polls every 2s while any job is still `queued` and stops once the
 * batch has fully drained — same settle-and-stop shape as
 * `reminderBatchQueryOptions`. */
export function invitationBatchQueryOptions(id: string) {
  return queryOptions({
    queryKey: invitationBatchKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<InviteBatchStatus>(`/users/invitations/batch/${id}`, {
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    refetchInterval: (query) =>
      query.state.data && query.state.data.queued > 0 ? INVITATION_BATCH_POLL_MS : false,
  });
}

export function useInvitationBatch(id: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({ ...invitationBatchQueryOptions(id ?? ''), enabled: id !== undefined });

  // The batch provisions new PARENT accounts and flips their
  // invitation_status as jobs drain — the staff list's filter should only
  // refetch once there is nothing left to provision (`queued` hits 0), not
  // on batch acceptance, when queued jobs haven't necessarily created the
  // accounts yet.
  React.useEffect(() => {
    if (query.data?.queued === 0) {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    }
  }, [query.data?.queued, queryClient]);

  return query;
}
