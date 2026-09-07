import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [15.5.6] Mirrors `server/src/modules/schools/profile/profile.service.ts`'s
 * `SchoolProfileView` — hand-typed rather than pulled from `schema.d.ts`
 * (not generated for this route yet, same gap `MaskedTenantSettings` in
 * `school-settings.ts` notes for `/schools/:id/settings`).
 */
export interface SchoolProfile {
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  logo_url: string | null;
}

export type UpdateSchoolProfileInput = Partial<
  Pick<SchoolProfile, 'name' | 'name_bn' | 'address' | 'phone' | 'email' | 'registration_id'>
>;

export const schoolProfileKeys = createEntityKeys('school-profile');

/** Always the caller's own school — the server resolves `me` from the
 * tenant context, never a path param, so there is only ever one profile
 * this hook can address. */
export function useSchoolProfile() {
  return useQuery({
    queryKey: schoolProfileKeys.detail('me'),
    queryFn: async () => (await apiClient.get<SchoolProfile>('/schools/me/profile')).data,
    retry: shouldRetryQuery,
  });
}

/** Non-optimistic — same reasoning as `useUpdateSchoolSettings`: a
 * rejected identity edit (e.g. an invalid EIIN) must never appear to have
 * saved. */
export function useUpdateSchoolProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSchoolProfileInput) =>
      (await apiClient.patch<SchoolProfile>('/schools/me/profile', input)).data,
    retry: shouldRetryQuery,
    onSuccess: (profile) => {
      queryClient.setQueryData(schoolProfileKeys.detail('me'), profile);
    },
  });
}

/** Uploads a logo file and refetches the profile (rather than trusting a
 * client-guessed shape for the response) so `logo_url`'s version query
 * param is always the one the server actually stored. */
export function useUploadSchoolLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return (await apiClient.post<{ logo_url: string }>('/schools/me/logo', formData)).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolProfileKeys.detail('me') });
    },
  });
}

export function useRemoveSchoolLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/schools/me/logo');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolProfileKeys.detail('me') });
    },
  });
}
