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

export const auditLogKeys = createEntityKeys<{ entityType: string; entityId: string }>(
  'audit-logs',
);

/** [8.10.2]'s Activity tab — `GET /audit-logs/entity/:entityType/:entityId`,
 * a narrower sibling of the ADMIN-only tenant-wide `GET /audit-logs` (no
 * client hook for that one yet — it has no caller until a future
 * tenant-wide audit screen exists). No page controls in the tab given this
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
