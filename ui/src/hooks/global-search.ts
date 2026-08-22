import { Permission, UserRole } from '@biddaloy/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useActiveRole } from './auth-state';
import { invoiceKeys, type Invoice } from './invoices';
import { paymentKeys, type Payment } from './payments';
import { useHasPermission } from './permissions';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { studentKeys, type Student } from './students';

export type Guardian = components['schemas']['Guardian'];
export type TeacherProfile = components['schemas']['TeacherResponseDto'];
export type { Invoice, Payment };

interface PaginatedEnvelope<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** A jump-to palette, not a list page — each entity's request is capped
 * this low so four parallel round trips (see the module docstring below)
 * stay cheap. A caller wanting the full result set opens that entity's
 * own filtered list page instead. */
const GLOBAL_SEARCH_LIMIT = 5;

/** `GET /teachers` has no dedicated `Permission` the way every other
 * entity here does (`users.controller.ts`'s `findAllTeachers` is
 * `@Roles`-gated directly) — mirrors that exact role list until one
 * lands, rather than reusing `Permission.USER_READ` (held only by
 * `ADMIN`) and hiding the group from the `ACCOUNTANT`/`EXECUTIVE`/
 * `TEACHER` roles the server already lets query it. */
const TEACHER_SEARCH_ROLES: readonly string[] = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
];

const guardianSearchKeys = createEntityKeys<{ search: string }>('guardians');
const teacherSearchKeys = createEntityKeys<{ search: string }>('teachers');

export interface GlobalSearchEntityResult<T> {
  data: T[];
  isLoading: boolean;
  isError: boolean;
}

export interface GlobalSearchResults {
  students: GlobalSearchEntityResult<Student>;
  guardians: GlobalSearchEntityResult<Guardian>;
  teachers: GlobalSearchEntityResult<TeacherProfile>;
  invoices: GlobalSearchEntityResult<Invoice>;
  receipts: GlobalSearchEntityResult<Payment>;
}

/**
 * Composes [8.9.9]'s Cmd/Ctrl+K palette out of four separate list
 * requests — genuinely four round trips today, not one, because no
 * unified `GET /search` exists server-side yet (flagged as its own
 * high-value backend addition in the issue's context, tracked
 * separately). Every group is `enabled: false` while `query` is blank —
 * an empty query fires nothing, matching the palette's "explain what's
 * searchable" empty state rather than showing an unfiltered listing —
 * and again while the active role can't read that entity, which is
 * fewer failed requests than fetching then hiding the group.
 *
 * Each `useQuery` forwards its `signal` into `apiClient`, so when the
 * caller's debounced `query` changes and this hook's last observer for
 * the *previous* value's queryKey unsubscribes, TanStack Query aborts
 * that still-in-flight request automatically — the in-flight-cancel-on-
 * new-input behaviour the issue's acceptance criteria call for needs no
 * manual `AbortController` bookkeeping here.
 */
export function useGlobalSearch(query: string): GlobalSearchResults {
  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const canReadStudents = useHasPermission(Permission.STUDENT_READ);
  const canReadGuardians = useHasPermission(Permission.GUARDIAN_READ);
  const canReadInvoices = useHasPermission(Permission.INVOICE_READ);
  const canReadReceipts = useHasPermission(Permission.PAYMENT_READ);
  const activeRole = useActiveRole();
  const canReadTeachers = activeRole !== null && TEACHER_SEARCH_ROLES.includes(activeRole);

  const students = useQuery(
    queryOptions({
      queryKey: studentKeys.list({ search: trimmed, limit: GLOBAL_SEARCH_LIMIT }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedEnvelope<Student>>('/students', {
          params: { search: trimmed, limit: GLOBAL_SEARCH_LIMIT },
          signal,
        });
        return res.data;
      },
      enabled: enabled && canReadStudents,
      retry: shouldRetryQuery,
    }),
  );

  const guardians = useQuery(
    queryOptions({
      queryKey: guardianSearchKeys.list({ search: trimmed }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedEnvelope<Guardian>>('/guardians', {
          params: { search: trimmed, limit: GLOBAL_SEARCH_LIMIT },
          signal,
        });
        return res.data;
      },
      enabled: enabled && canReadGuardians,
      retry: shouldRetryQuery,
    }),
  );

  const teachers = useQuery(
    queryOptions({
      queryKey: teacherSearchKeys.list({ search: trimmed }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedEnvelope<TeacherProfile>>('/teachers', {
          params: { search: trimmed, limit: GLOBAL_SEARCH_LIMIT },
          signal,
        });
        return res.data;
      },
      enabled: enabled && canReadTeachers,
      retry: shouldRetryQuery,
    }),
  );

  const invoices = useQuery(
    queryOptions({
      queryKey: invoiceKeys.list({ search: trimmed }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedEnvelope<Invoice>>('/invoices', {
          params: { search: trimmed, limit: GLOBAL_SEARCH_LIMIT },
          signal,
        });
        return res.data;
      },
      enabled: enabled && canReadInvoices,
      retry: shouldRetryQuery,
    }),
  );

  const receipts = useQuery(
    queryOptions({
      queryKey: paymentKeys.list({ search: trimmed }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedEnvelope<Payment>>('/payments', {
          params: { search: trimmed, limit: GLOBAL_SEARCH_LIMIT },
          signal,
        });
        return res.data;
      },
      enabled: enabled && canReadReceipts,
      retry: shouldRetryQuery,
    }),
  );

  return {
    students: {
      data: students.data?.data ?? [],
      isLoading: enabled && canReadStudents && students.isLoading,
      isError: students.isError,
    },
    guardians: {
      data: guardians.data?.data ?? [],
      isLoading: enabled && canReadGuardians && guardians.isLoading,
      isError: guardians.isError,
    },
    teachers: {
      data: teachers.data?.data ?? [],
      isLoading: enabled && canReadTeachers && teachers.isLoading,
      isError: teachers.isError,
    },
    invoices: {
      data: invoices.data?.data ?? [],
      isLoading: enabled && canReadInvoices && invoices.isLoading,
      isError: invoices.isError,
    },
    receipts: {
      data: receipts.data?.data ?? [],
      isLoading: enabled && canReadReceipts && receipts.isLoading,
      isError: receipts.isError,
    },
  };
}
