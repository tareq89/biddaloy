import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type StaffUser = components['schemas']['UserResponseDto'];
export type CreateUserInput = components['schemas']['CreateUserDto'];
export type UpdateUserInput = components['schemas']['UpdateUserDto'];
// [8.14.4] `PATCH /users/me`'s own DTO — distinct from `UpdateUserInput`
// (`UpdateUserDto`) because it carries the caller-provided
// `current_password` proof `UpdateUserDto` has no field for (see
// `UpdateOwnProfileDto`'s own comment in `schema.d.ts`).
export type UpdateOwnProfileInput = components['schemas']['UpdateOwnProfileDto'];
export type UserRoleFilter = NonNullable<CreateUserInput['role']>;

export interface UserListFilters {
  role?: UserRoleFilter;
  search?: string;
  page?: number;
  limit?: number;
}

/** `GET /api/v1/users`'s 200 body is untyped in `schema.d.ts` — same gap
 * `guardians.ts`'s `PaginatedGuardians` documents — hand-typed against
 * the `{ data, total, page, limit, totalPages }` envelope every list
 * endpoint actually returns (`UserController.findAllUsers`). */
export interface PaginatedUsers {
  data: StaffUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const userKeys = createEntityKeys<UserListFilters>('users');

/** [8.11.8]'s staff list — mirrors `guardians.ts`'s `guardiansQueryOptions`. */
export function usersQueryOptions(filters: UserListFilters) {
  return queryOptions({
    queryKey: userKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedUsers>('/users', { params: filters, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useUsers(filters: UserListFilters) {
  return useQuery(usersQueryOptions(filters));
}

export function userQueryOptions(id: string) {
  return queryOptions({
    queryKey: userKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffUser>(`/users/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({ ...userQueryOptions(id ?? ''), enabled: id !== undefined });
}

/** [8.14.2]'s `AppHeader` user menu — the signed-in user's own record.
 * `GET /users/me` (`UserController`) is open to every staff **and**
 * guardian role (ADMIN, ACCOUNTANT, EXECUTIVE, TEACHER, PARENT, STUDENT —
 * see `users.controller.ts`'s own `@Roles` list), unlike `/users/{id}`
 * which is staff-only, so this is the one user-record read a guardian can
 * make too. Keyed under `userKeys.detail('me')` rather than the caller's
 * own id — the JWT's `sub` isn't decoded client-side for this (`session.ts`'s
 * `decodeAccessTokenSubject` returns an id, not a name — that's the whole
 * reason this hook exists) — so a literal `'me'` segment keeps the cache
 * key stable across users without needing one. */
export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: userKeys.detail('me'),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffUser>('/users/me', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCurrentUser() {
  return useQuery(currentUserQueryOptions());
}

/** [8.14.4]'s `/portal/account` profile card — `PATCH /users/me`. Only
 * invalidates the `'me'` detail key, never `userKeys.lists()`: this
 * caller's own record is not necessarily on any staff list they can even
 * see (a PARENT/STUDENT 403s on `GET /users`), so refetching a list this
 * caller may not hold is both wasted work and a request that could fail
 * for a reason unrelated to the edit that just succeeded. */
export function useUpdateOwnProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOwnProfileInput) => {
      const res = await apiClient.patch<StaffUser>('/users/me', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.detail('me') });
    },
  });
}

/** `POST /users`'s 201 body: the created user plus the membership row the
 * server creates in the same transaction (`UserService.create`). */
export interface CreateUserResult {
  user: StaffUser;
  membership: { id: string; role: string; tenant_id: string; user_id: string };
}

/** [8.11.8]'s Add-user dialog. 409 = duplicate email (surfaced inline by
 * the dialog, not retried — `shouldRetryQuery` is queries-only; mutations
 * don't retry at all, matching every other entity's create hook. */
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const res = await apiClient.post<CreateUserResult>('/users', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      const res = await apiClient.patch<StaffUser>(`/users/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/** `DELETE /users/{id}` removes only the active school's membership row —
 * "remove from school", not account deletion (`UserService.remove`). The
 * server 400s on self-removal; the UI additionally disables the action
 * (see [8.11.8]'s remove-member dialog). */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/users/${id}`);
    },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      queryClient.removeQueries({ queryKey: userKeys.detail(id) });
    },
  });
}
