import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type AuditLog = components['schemas']['AuditLogResponseDto'];

export interface PaginatedAuditLogs {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * camelCase on purpose — this is a **cache-key** shape, shared by every
 * audit-log list variant (a student's Activity tab, a staff member's
 * Login History, [8.11.10]'s tenant-wide trail), so one
 * `auditLogKeys.lists()` invalidation reaches all of them. The wire
 * params are snake_case; `toAuditLogQueryParams` below is the one place
 * that translation happens.
 */
export interface AuditLogListFilters {
  entityType?: string;
  /** Only ever a key discriminator for `useAuditLogsByEntity`, whose
   * entity id travels in the **path**, not the query string — so it is
   * deliberately absent from `toAuditLogQueryParams`. `GET /audit-logs`
   * has no `entity_id` param to send it to. */
  entityId?: string;
  /** [8.11.8]'s Login History tab — maps to `GET /audit-logs`'s
   * `performed_by_user_id` query param. */
  performedByUserId?: string;
  action?: AuditLog['action'];
  /** [8.11.10]'s date-range filter. Date-only `YYYY-MM-DD` strings; the
   * server widens `toDate` to that day's last millisecond so an
   * inclusive range end really is inclusive (`audit.service.ts`). */
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export const auditLogKeys = createEntityKeys<AuditLogListFilters>('audit-logs');

/** The camelCase-filter → snake_case-query-param translation, kept in one
 * place so a new filter can't reach the wire under the wrong name. Keys
 * with an `undefined` value are dropped rather than sent empty — an
 * `?action=` with no value is a 400 from `QueryAuditLogDto`'s `@IsEnum`,
 * not a "no filter". */
function toAuditLogQueryParams(filters: AuditLogListFilters): Record<string, string | number> {
  return {
    ...(filters.action !== undefined ? { action: filters.action } : {}),
    ...(filters.entityType !== undefined ? { entity_type: filters.entityType } : {}),
    ...(filters.performedByUserId !== undefined
      ? { performed_by_user_id: filters.performedByUserId }
      : {}),
    ...(filters.fromDate !== undefined ? { from_date: filters.fromDate } : {}),
    ...(filters.toDate !== undefined ? { to_date: filters.toDate } : {}),
    ...(filters.page !== undefined ? { page: filters.page } : {}),
    ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
  };
}

/**
 * [8.11.10]'s tenant-wide audit trail — the ADMIN-only
 * `GET /audit-logs`, newest-first (the server's own `created_at DESC`;
 * nothing re-sorts client-side). Callers gate the page on
 * `Permission.AUDIT_LOG_READ` so the UI and the server's `@Roles(ADMIN)`
 * agree instead of rendering a screen that can only 403.
 */
export function auditLogsQueryOptions(filters: AuditLogListFilters = {}) {
  return queryOptions({
    queryKey: auditLogKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedAuditLogs>('/audit-logs', {
        params: toAuditLogQueryParams(filters),
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAuditLogs(filters: AuditLogListFilters = {}) {
  return useQuery(auditLogsQueryOptions(filters));
}

/** [8.11.8]'s Login History tab — the ADMIN-only tenant-wide
 * `GET /audit-logs`, scoped to one user's LOGIN events via the
 * `performed_by_user_id` filter added on the same branch. Callers gate on
 * `Permission.AUDIT_LOG_READ` (ADMIN-only in `ROLE_PERMISSIONS`) so the
 * UI and the server's `@Roles(ADMIN)` agree. First page only, same
 * reasoning as `useAuditLogsByEntity` below. */
export function useLoginAuditLogs(userId: string) {
  return useQuery(
    queryOptions({
      queryKey: auditLogKeys.list({ performedByUserId: userId, action: 'LOGIN' }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedAuditLogs>('/audit-logs', {
          params: { action: 'LOGIN', performed_by_user_id: userId },
          signal,
        });
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

/** [8.10.2]'s Activity tab — `GET /audit-logs/entity/:entityType/:entityId`,
 * a narrower sibling of the ADMIN-only tenant-wide `GET /audit-logs`
 * ([8.11.10]'s `useAuditLogs` above). No page controls in the tab given this
 * ticket's own scope — the first page (server default `limit: 10`) is
 * what's rendered; paging through a single student's history is a
 * follow-up, not part of "view a student's full record". */
export function useAuditLogsByEntity(entityType: string, entityId: string) {
  return useQuery(
    queryOptions({
      queryKey: auditLogKeys.list({ entityType, entityId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaginatedAuditLogs>(
          `/audit-logs/entity/${entityType}/${entityId}`,
          { signal },
        );
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}
