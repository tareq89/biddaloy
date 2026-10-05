import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useLoginAuditLogs, type AuditLog } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

import { describeUserAgent } from './describe-user-agent';
import { TabQueryState } from './tab-query-state';

export interface LoginHistoryTabProps {
  userId: string;
}

/**
 * `GET /audit-logs?action=LOGIN&performed_by_user_id={id}` — ADMIN-only
 * server-side, which is why `$userId.tsx` only mounts this tab behind
 * `useHasPermission(Permission.AUDIT_LOG_READ)`. First page only, same
 * scope call as `useAuditLogsByEntity`'s own comment.
 */
export function LoginHistoryTab({ userId }: LoginHistoryTabProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const query = useLoginAuditLogs(userId);

  const columns: DataTableColumn<AuditLog>[] = [
    {
      id: 'when',
      header: t('detail.loginHistory.columnWhen'),
      accessorFn: (entry) => formatDateTime(new Date(entry.created_at), regionConfig),
      card: 'title',
    },
    {
      id: 'device',
      header: t('detail.loginHistory.columnDevice'),
      // The raw string stays in `title` for support staff.
      accessorFn: (entry) => (
        <span title={entry.user_agent ?? ''}>
          {describeUserAgent(entry.user_agent, t('detail.loginHistory.unknownBrowser'))}
        </span>
      ),
    },
    {
      id: 'ip',
      header: t('detail.loginHistory.columnIp'),
      accessorFn: (entry) => entry.ip_address ?? '—',
    },
  ];

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loginHistory.errorMessage')}
    >
      {(page) => (
        <DataTable
          tableId="staff-login-history"
          caption={t('detail.loginHistory.caption')}
          columns={columns}
          data={page.data}
          getRowId={(entry) => entry.id}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={page.data.length}
          paginated={false}
          emptyState={{
            title: t('detail.loginHistory.empty'),
            explanation: t('detail.loginHistory.emptyExplanation'),
          }}
        />
      )}
    </TabQueryState>
  );
}
