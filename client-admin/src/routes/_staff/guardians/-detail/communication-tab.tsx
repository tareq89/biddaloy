import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useGuardianCommunicationLogs } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface CommunicationTabProps {
  guardianId: string;
}

export function CommunicationTab({ guardianId }: CommunicationTabProps) {
  const { t } = useTranslation('guardians');
  const query = useGuardianCommunicationLogs(guardianId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.communication.errorMessage')}
    >
      {(logs) =>
        logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.communication.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.communication.columnDate')}</TableHead>
                <TableHead>{t('detail.communication.columnMedium')}</TableHead>
                <TableHead>{t('detail.communication.columnRecipient')}</TableHead>
                <TableHead>{t('detail.communication.columnStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{log.created_at}</TableCell>
                  <TableCell>{log.medium}</TableCell>
                  <TableCell>{log.recipient_name}</TableCell>
                  <TableCell>{log.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
