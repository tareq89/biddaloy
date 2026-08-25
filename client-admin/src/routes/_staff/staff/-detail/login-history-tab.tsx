import { useLoginAuditLogs } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

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

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loginHistory.errorMessage')}
    >
      {(page) =>
        page.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.loginHistory.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('detail.loginHistory.columnWhen')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('detail.loginHistory.columnIp')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('detail.loginHistory.columnDevice')}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="py-1 pr-4">
                    {formatDateTime(new Date(entry.created_at), regionConfig)}
                  </td>
                  <td className="py-1 pr-4">
                    {entry.ip_address ?? t('detail.loginHistory.emptyValue')}
                  </td>
                  <td className="py-1">
                    {entry.user_agent ?? t('detail.loginHistory.emptyValue')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </TabQueryState>
  );
}
