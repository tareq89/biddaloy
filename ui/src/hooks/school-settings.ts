import type { BackupScheduleMode, InvitationStatus } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [14.12.3/#617] Intersected with `& { backup?: BackupSettings }` —
 * `schema.d.ts` hasn't been regenerated against the server's
 * `TenantSettingsDto.backup` field yet (see `BackupSettings`'s own
 * comment below for the fuller gap), but `useUpdateSchoolSettings`'s PATCH
 * body needs to be able to carry `{ version: 1, backup: {...} }` like
 * every other section's own slice.
 */
export type TenantSettingsInput = components['schemas']['TenantSettingsDto'] & {
  backup?: BackupSettings;
};
export type TestConnectionInput = components['schemas']['TestConnectionDto'];
export type TestableMedium = TestConnectionInput['medium'];

/** `slug`/`status`/`created_at` (#533) aren't in `schema.d.ts` yet —
 * `SchoolListItemDto` grew them server-side in the same change (see
 * `server/src/modules/schools/dto/school-list-item.dto.ts`), but this repo
 * regenerates `schema.d.ts` at integration time, not per-lane. Hand-typed
 * here against that DTO's actual shape, same gap `PaginatedStudents`
 * documents elsewhere in this file's sibling hooks. */
export interface SchoolSummary {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  created_at: string;
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

/** [9.10] Not secret data, unlike `communications` above — the attendance
 * policy has no `Secret()`-decorated fields (`tenant-settings.dto.ts`'s
 * `AttendancePolicyDto`), so the GET response mirrors `TenantSettingsInput
 * ['attendance']` exactly rather than needing its own `Masked*` shape. */
export type AttendancePolicySettings = NonNullable<TenantSettingsInput['attendance']>;

/** [12.5] Not secret data either — `AuthSettingsDto` has no `Secret()`-decorated
 * fields, same reasoning as `AttendancePolicySettings` above. */
export type AuthSettings = NonNullable<TenantSettingsInput['auth']>;

/** [14.12.1/#615 D10] Not secret data — `BackupSettingsDto` has no
 * `Secret()`-decorated fields. Hand-typed against `BackupScheduleMode`
 * (`@biddaloy/shared`) rather than `TenantSettingsInput['backup']`:
 * `schema.d.ts` hasn't been regenerated against the server's
 * `BackupSettingsDto` yet, same gap `SchoolSummary` documents elsewhere in
 * this file. */
export interface BackupSettings {
  schedule: BackupScheduleMode;
}

export interface MaskedTenantSettings {
  version: 1;
  region: MaskedRegionSettings;
  communications?: MaskedCommunicationsSettings;
  attendance?: AttendancePolicySettings;
  auth?: AuthSettings;
  backup?: BackupSettings;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export const schoolsKeys = createEntityKeys('schools');
export const schoolSettingsKeys = createEntityKeys('school-settings');

/** `POST /schools` request/response shapes (#534's wizard, `#529`'s
 * `ProvisionSchoolDto`/response). Not in `schema.d.ts` yet — same
 * hand-typed-against-the-DTO gap `SchoolSummary` documents above, since
 * this repo regenerates `schema.d.ts` at integration time, not per-lane. */
export interface ProvisionSchoolAdminInput {
  name: string;
  email?: string;
  phone?: string;
}

export interface ProvisionSchoolInput {
  name: string;
  slug: string;
  admin: ProvisionSchoolAdminInput;
  idempotency_key: string;
}

export interface ProvisionSchoolResult {
  school: { id: string; slug: string; status: 'ACTIVE' | 'SUSPENDED' };
  admin: { user_id: string; existed: boolean };
  invitation: { id: string; status: string };
}

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

/** #534's create-school wizard. Non-optimistic — same reasoning as
 * `useUpdateSchoolSettings` above: a school that appears created but was
 * rejected would be worse than the pending spinner. `idempotency_key` is
 * the caller's job to generate once and reuse across retries (see
 * `new.tsx`'s `React.useState(() => crypto.randomUUID())`) — this hook
 * just forwards whatever it's given, so a retried `.mutate()` call with
 * the same key hits `ProvisioningService`'s Redis-backed no-op replay
 * instead of creating a second school. Invalidates the list query on
 * success so `/schools` reflects the new row without a manual refetch. */
export function useProvisionSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProvisionSchoolInput) =>
      (await apiClient.post<ProvisionSchoolResult>('/schools', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolsKeys.lists() });
    },
  });
}

/** [8.14.5]: extracted for symmetry with `invoiceQueryOptions` — not
 * actually called from a route `loader`, since `schoolId` here comes from
 * `useSchools()` client-side (not a route param), so `_staff/settings.tsx`
 * cannot preload this data ahead of the loader running (see the plan's
 * "plan correction 5"). Kept as a factory anyway so `useSchoolSettings`
 * and any future loader-based caller share one `queryKey`/`queryFn`. */
export function schoolSettingsQueryOptions(schoolId: string) {
  return queryOptions({
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

export function useSchoolSettings(schoolId: string) {
  return useQuery(schoolSettingsQueryOptions(schoolId));
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

/** #535's school detail page. `GET /schools/:id/stats` (#532) — five cheap
 * platform metrics, hand-typed against `SchoolStats`
 * (`server/src/modules/schools/schools.service.ts`) since it's not in
 * `schema.d.ts` yet, same gap `SchoolSummary` documents above.
 * `last_activity_at` travels as an ISO string over the wire even though
 * the server type is `Date | null` — same as every other timestamp this
 * file's siblings (`students.ts` etc.) leave as a string for the caller
 * to `new Date()` only where it's actually rendered. */
export interface SchoolStats {
  active_users: number;
  students: number;
  communications_queued: number;
  communications_failed_7d: number;
  last_activity_at: string | null;
}

const schoolStatsKeys = createEntityKeys<never, string>('school-stats');

export function schoolStatsQueryOptions(schoolId: string) {
  return queryOptions({
    queryKey: schoolStatsKeys.detail(schoolId),
    queryFn: async () => (await apiClient.get<SchoolStats>(`/schools/${schoolId}/stats`)).data,
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

export function useSchoolStats(schoolId: string) {
  return useQuery(schoolStatsQueryOptions(schoolId));
}

/** `PATCH /schools/:id/status` (#530) response — mirrors
 * `SchoolStatusResponse` (`schools.service.ts`), hand-typed for the same
 * not-yet-generated reason as `SchoolStats` above. */
export interface SchoolStatusResult {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  status_reason: string;
  status_changed_at: string;
}

export interface UpdateSchoolStatusInput {
  status: 'ACTIVE' | 'SUSPENDED';
  reason: string;
}

/** Optimistic-free: `DetailShell`'s confirm dialog only closes on success
 * (see `-status-action-dialog.tsx`), so there's no window where the UI
 * shows a status the server hasn't actually committed. Refetches the
 * detail-page queries that embed status (`schoolsKeys.detail`, the list)
 * on success instead of writing the cache by hand — same
 * invalidate-after-mutate shape `useProvisionSchool` above uses. */
export function useUpdateSchoolStatus(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSchoolStatusInput) =>
      (await apiClient.patch<SchoolStatusResult>(`/schools/${schoolId}/status`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolsKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: schoolsKeys.detail(schoolId) });
    },
  });
}

/** `GET /schools/:id/admins` (#531) list item — mirrors
 * `SchoolAdminListItem` (`school-admins.service.ts`), same hand-typed gap. */
export interface SchoolAdminListItem {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  membership_status: string;
  invitation: { id: string; status: InvitationStatus; expires_at: string } | null;
}

export const schoolAdminsKeys = createEntityKeys('school-admins');

export function schoolAdminsQueryOptions(schoolId: string) {
  return queryOptions({
    queryKey: schoolAdminsKeys.list({ schoolId }),
    queryFn: async () =>
      (await apiClient.get<SchoolAdminListItem[]>(`/schools/${schoolId}/admins`)).data,
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

export function useSchoolAdmins(schoolId: string) {
  return useQuery(schoolAdminsQueryOptions(schoolId));
}

export interface AddSchoolAdminInput {
  name: string;
  email?: string;
  phone?: string;
}

/** `POST /schools/:id/admins` (#531) — reuses the same find-or-create-user
 * path `POST /schools`'s own admin step does. Invalidates the admins list
 * on success, same pattern `useProvisionSchool` uses for the schools list. */
export function useAddSchoolAdmin(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddSchoolAdminInput) =>
      (await apiClient.post<SchoolAdminListItem>(`/schools/${schoolId}/admins`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolAdminsKeys.list({ schoolId }) });
    },
  });
}

/** `POST /schools/:id/admins/:userId/resend-invitation` (#531) — 204, no
 * body, same shape as `users.ts`'s own `useResendInvitation` for a staff
 * member's invitation. */
export function useResendSchoolAdminInvitation(schoolId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post<void>(`/schools/${schoolId}/admins/${userId}/resend-invitation`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolAdminsKeys.list({ schoolId }) });
    },
  });
}

/** `DELETE /schools/:id/admins/:userId/invitation` (#531) — 204, no body. */
export function useRevokeSchoolAdminInvitation(schoolId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/schools/${schoolId}/admins/${userId}/invitation`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolAdminsKeys.list({ schoolId }) });
    },
  });
}
