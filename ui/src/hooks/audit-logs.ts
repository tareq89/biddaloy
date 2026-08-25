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

export interface AuditLogListFilters {
  entityType?: string;
  entityId?: string;
  /** [8.11.8]'s Login History tab (and #179's "who" filter) — maps to
   * `GET /audit-logs`'s `performed_by_user_id` query param. */
  performedByUserId?: string;
  action?: AuditLog['action'];
}

export const auditLogKeys = createEntityKeys<AuditLogListFilters>('audit-logs');

/** [8.10.2]'s Activity tab — `GET /audit-logs/entity/:entityType/:entityId`,
 * a narrower sibling of the ADMIN-only tenant-wide `GET /audit-logs` (no
 * client hook for that one yet — it has no caller until a future
 * tenant-wide audit screen exists). No page controls in the tab given this
 * ticket's own scope — the first page (server default `limit: 10`) is
 * what's rendered; paging through a single student's history is a
 * follow-up, not part of "view a student's full record". */
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
