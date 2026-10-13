import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, postAuthRefresh } from '../api/client';
import type { components } from '../api/schema';
import { useTranslation } from '../i18n';

import { adoptSession } from './auth';

export type SchoolInvite = components['schemas']['SchoolInviteDto'];

export const schoolInvitesKey = ['account', 'school-invites'] as const;

/** `GET /account/school-invites` — the caller's pending requests to join a school.
 * `staleTime: 0`: a school can add the person from another device at any time. */
export function useSchoolInvites() {
  return useQuery({
    queryKey: schoolInvitesKey,
    queryFn: async ({ signal }): Promise<SchoolInvite[]> =>
      (await apiClient.get<SchoolInvite[]>('/account/school-invites', { signal })).data,
    staleTime: 0,
    retry: false,
  });
}

/** The accept went through but the token refresh did not: the membership exists, the token lacks it. */
class AcceptRefreshError extends Error {}

/** Accept, then refresh the token so the new membership is in it (no sign-out). */
export function useAcceptSchoolInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/account/school-invites/${id}/accept`);
      try {
        return await adoptSession(queryClient, await postAuthRefresh());
      } catch {
        throw new AcceptRefreshError();
      }
    },
    // Settled, not success: if accept worked but the refresh failed, the
    // list must still drop the invite instead of offering Accept again.
    onSettled: () => queryClient.invalidateQueries({ queryKey: schoolInvitesKey }),
  });
}

/** Retry only the token refresh after an accept whose refresh failed (never re-sends the accept). */
function useRetryAcceptRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => adoptSession(queryClient, await postAuthRefresh()),
  });
}

/** Decline: no membership is created; the list is refetched. */
export function useDeclineSchoolInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/account/school-invites/${id}/decline`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: schoolInvitesKey }),
  });
}

/** Everything `SchoolInvitesCard` needs, wired: list, both handlers, busy and error text.
 * `count` lets the account menu show how many are waiting. */
export function useSchoolInvitesCardProps() {
  const { t } = useTranslation('nav');
  const { data: invites = [] } = useSchoolInvites();
  const accept = useAcceptSchoolInvite();
  const decline = useDeclineSchoolInvite();
  const retryRefresh = useRetryAcceptRefresh();
  const refreshPending = accept.error instanceof AcceptRefreshError && !retryRefresh.isSuccess;
  const failed = accept.isError || decline.isError || retryRefresh.isError;
  return {
    count: invites.length,
    cardProps: {
      invites,
      onAccept: (id: string) => {
        // A retry that succeeded for an earlier accept must not hide this one's recovery button.
        retryRefresh.reset();
        accept.mutate(id);
      },
      onDecline: (id: string) => decline.mutate(id),
      busy: accept.isPending || decline.isPending || retryRefresh.isPending,
      ...(failed && { error: t('schoolInvites.error') }),
      // The invite is already gone from the list, so the card stays up for this alone.
      ...(refreshPending && { onRetryRefresh: () => retryRefresh.mutate() }),
    },
  };
}
