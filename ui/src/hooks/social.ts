import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import { apiClient, toApiError } from '../api/client';
import type { components } from '../api/schema';

import { shouldRetryQuery } from './retry';

export type SocialIdentity = components['schemas']['SocialIdentityDto'];
export type SocialProvider = SocialIdentity['provider'];

export const socialKeys = {
  providers: ['auth', 'social', 'providers'] as const,
  identities: ['auth', 'social', 'identities'] as const,
};

/** `GET /auth/social/providers` — public (login/register screens run before a
 * session exists), so bare axios rather than `apiClient`. */
export function socialProvidersQueryOptions() {
  return queryOptions({
    queryKey: socialKeys.providers,
    queryFn: async ({ signal }): Promise<SocialProvider[]> => {
      try {
        const res = await axios.get<components['schemas']['SocialProvidersDto']>(
          '/api/v1/auth/social/providers',
          { signal },
        );
        return res.data.providers;
      } catch (error) {
        throw toApiError(error);
      }
    },
    retry: shouldRetryQuery,
  });
}

/** Where the browser navigates to sign in / register with a provider — the
 * server answers with a 302 to the provider, so this is a URL, not a fetch. */
export function socialStartUrl(
  provider: SocialProvider,
  intent: 'login' | 'register',
  redirect?: string,
): string {
  const params = new URLSearchParams({ intent });
  if (redirect) params.set('redirect', redirect);
  return `/api/v1/auth/social/${provider}/start?${params.toString()}`;
}

/** `GET /auth/social/identities` — the signed-in user's linked accounts. */
export function identitiesQueryOptions() {
  return queryOptions({
    queryKey: socialKeys.identities,
    queryFn: async ({ signal }) =>
      (await apiClient.get<SocialIdentity[]>('/auth/social/identities', { signal })).data,
    retry: shouldRetryQuery,
  });
}

/** `DELETE /auth/social/identities/:provider`. */
export function useDisconnectIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: SocialProvider) => {
      await apiClient.delete(`/auth/social/identities/${provider}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: socialKeys.identities }),
  });
}

/** `POST /auth/social/:provider/link-start` needs the bearer token, so the SPA
 * fetches it and navigates itself: `window.location.assign(await mutateAsync(p))`. */
export function useStartSocialLink() {
  return useMutation({
    mutationFn: async (provider: SocialProvider) =>
      (
        await apiClient.post<components['schemas']['SocialLinkStartDto']>(
          `/auth/social/${provider}/link-start`,
        )
      ).data.url,
  });
}
