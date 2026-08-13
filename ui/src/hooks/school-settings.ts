import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type TenantSettingsInput = components['schemas']['TenantSettingsDto'];
export type TestConnectionInput = components['schemas']['TestConnectionDto'];
export type TestableMedium = TestConnectionInput['medium'];

export interface SchoolSummary {
  id: string;
  name: string;
}

/** Mirrors `server/src/modules/schools/settings/settings-mask.util.ts`'s
 * `MaskedSecret` — not generated into `schema.d.ts` (the settings GET/PATCH
 * responses aren't typed server-side, see `PaginatedStudents`'s own comment
 * on the same gap for `/students`), so hand-typed here against the API's
 * actual documented behavior instead. `configured: false` and the key
 * being entirely absent both mean "nothing to show a hint for" — see
 * `settings-mask.util.ts`'s own comment on why those two states differ
 * (never configured vs. explicitly cleared) even though a caller mostly
 * treats them the same. */
export interface MaskedSecret {
  configured: boolean;
  hint?: string;
}

export type MaskedRegionSettings = NonNullable<TenantSettingsInput['region']>;

export interface MaskedGreenwebSmsSettings {
  apiKey?: MaskedSecret;
  apiUrl?: string;
}

export interface MaskedMimSmsSettings {
  apiKey?: MaskedSecret;
  senderId: string;
  apiUrl?: string;
}

export interface MaskedSmsSettings {
  provider: 'greenweb' | 'mimsms';
  greenweb?: MaskedGreenwebSmsSettings;
  mimsms?: MaskedMimSmsSettings;
}

export interface MaskedWhatsAppSettings {
  phoneNumberId: string;
  apiVersion?: string;
  accessToken?: MaskedSecret;
}

export interface MaskedEmailSettings {
  host: string;
  port: number;
  user: string;
  from: string;
  password?: MaskedSecret;
}

export interface MaskedMessengerSettings {
  pageId: string;
  accessToken?: MaskedSecret;
}

export interface MaskedCommunicationsSettings {
  sms?: MaskedSmsSettings;
  whatsapp?: MaskedWhatsAppSettings;
  email?: MaskedEmailSettings;
  messenger?: MaskedMessengerSettings;
}

export interface MaskedTenantSettings {
  version: 1;
  region: MaskedRegionSettings;
  communications?: MaskedCommunicationsSettings;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export const schoolsKeys = createEntityKeys('schools');
export const schoolSettingsKeys = createEntityKeys('school-settings');

/** #8.7.13's super-admin school picker — `GET /schools` 401s for anyone
 * who isn't a SUPER_ADMIN (see `schools.controller.ts`), so callers should
 * pass `enabled: false` rather than firing this for an ADMIN, who has no
 * use for a picker anyway (they only ever configure their own school). */
export function useSchools(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: schoolsKeys.lists(),
    queryFn: async () => (await apiClient.get<SchoolSummary[]>('/schools')).data,
    enabled: options.enabled ?? true,
    retry: shouldRetryQuery,
  });
}

export function useSchoolSettings(schoolId: string) {
  return useQuery({
    queryKey: schoolSettingsKeys.detail(schoolId),
    queryFn: async () =>
      (await apiClient.get<MaskedTenantSettings>(`/schools/${schoolId}/settings`)).data,
    // A SUPER_ADMIN's picker starts with no school selected, so `schoolId`
    // can be `''` before this hook has a real target — without this guard
    // that fires a GET against `/schools//settings`, a malformed URL, on
    // every mount.
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

/**
 * Non-optimistic by design — #8.7.13's own acceptance criteria: "a config
 * that appears saved but was rejected would silently break every message
 * the school sends." No `onMutate`, no cache write before the server
 * responds; `isPending` is the only signal a caller has during the
 * request, same shape as `payments.ts`'s `useCreatePayment` (that file's
 * own comment is the fuller writeup of why this shape matters for a
 * mutation with real consequences if the UI gets ahead of the server).
 */
export function useUpdateSchoolSettings(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TenantSettingsInput) =>
      (await apiClient.patch<MaskedTenantSettings>(`/schools/${schoolId}/settings`, input)).data,
    retry: shouldRetryQuery,
    onSuccess: (settings) => {
      queryClient.setQueryData(schoolSettingsKeys.detail(schoolId), settings);
    },
  });
}

/** Doesn't touch the settings cache — a connection test changes nothing
 * persisted, whether it passes or fails. */
export function useTestSchoolConnection(schoolId: string) {
  return useMutation({
    mutationFn: async (input: TestConnectionInput) =>
      (await apiClient.post<ConnectionTestResult>(`/schools/${schoolId}/settings/test`, input))
        .data,
    retry: shouldRetryQuery,
  });
}
