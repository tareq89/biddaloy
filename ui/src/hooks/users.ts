import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type StaffUser = components['schemas']['UserResponseDto'];
export type CreateUserInput = components['schemas']['CreateUserDto'];
export type UpdateUserInput = components['schemas']['UpdateUserDto'];
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
