import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useAuditLogsByEntity } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface ActivityTabProps {
  studentId: string;
}

export function ActivityTab({ studentId }: ActivityTabProps) {
  const { t } = useTranslation('students');
  const query = useAuditLogsByEntity('Student', studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.activity.errorMessage')}
    >
      {(auditLogsPage) =>
        auditLogsPage.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.activity.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.activity.columnDate')}</TableHead>
                <TableHead>{t('detail.activity.columnAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogsPage.data.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{log.created_at}</TableCell>
                  <TableCell>{log.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
