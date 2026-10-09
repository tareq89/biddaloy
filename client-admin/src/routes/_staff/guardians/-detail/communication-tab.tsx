import { Card, DataTable, StatusBadge } from '@biddaloy/ui/components';
import { useGuardianCommunicationLogs } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface CommunicationTabProps {
  guardianId: string;
}

export function CommunicationTab({ guardianId }: CommunicationTabProps) {
  const { t } = useTranslation('guardians');
  const regionConfig = useRegionConfig();
  const query = useGuardianCommunicationLogs(guardianId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.communication.errorMessage')}
    >
      {(logs) => (
        <Card className="overflow-hidden">
          <DataTable
            tableId="guardian-communication"
            caption={t('detail.tabs.communication')}
            paginated={false}
            sorting={null}
            onSortingChange={() => undefined}
            totalCount={logs.length}
            data={logs}
            getRowId={(log) => log.id}
            columns={[
              {
                id: 'date',
                header: t('detail.communication.columnDate'),
                accessorFn: (log) => formatDate(parseServerDate(log.created_at), regionConfig),
                card: 'title',
              },
              {
                id: 'medium',
                header: t('detail.communication.columnMedium'),
                accessorFn: (log) =>
                  t(`preferredCommunicationOptions.${log.medium}`, { defaultValue: log.medium }),
              },
              {
                id: 'recipient',
                header: t('detail.communication.columnRecipient'),
                accessorFn: (log) => log.recipient_name,
              },
              {
                id: 'status',
                header: t('detail.communication.columnStatus'),
                accessorFn: (log) => <StatusBadge domain="communication" status={log.status} />,
                card: 'badge',
              },
            ]}
            emptyState={{
              title: t('detail.communication.emptyMessage'),
              explanation: t('detail.communication.emptyExplanation'),
            }}
          />
        </Card>
      )}
    </TabQueryState>
  );
}
