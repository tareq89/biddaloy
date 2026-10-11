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

/** Accept, then refresh the token so the new membership is in it (no sign-out). */
export function useAcceptSchoolInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/account/school-invites/${id}/accept`);
      return adoptSession(queryClient, await postAuthRefresh());
    },
    // Settled, not success: if accept worked but the refresh failed, the
    // list must still drop the invite instead of offering Accept again.
    onSettled: () => queryClient.invalidateQueries({ queryKey: schoolInvitesKey }),
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
  const failed = accept.isError || decline.isError;
  return {
    count: invites.length,
    cardProps: {
      invites,
      onAccept: (id: string) => accept.mutate(id),
      onDecline: (id: string) => decline.mutate(id),
      busy: accept.isPending || decline.isPending,
      ...(failed && { error: t('schoolInvites.error') }),
    },
  };
}
