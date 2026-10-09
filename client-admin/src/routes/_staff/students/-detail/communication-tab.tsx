import { DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useStudentCommunicationLogs } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import { MessageSquareIcon } from 'lucide-react';

import { TabQueryState } from './tab-query-state';

export interface CommunicationTabProps {
  studentId: string;
}

export function CommunicationTab({ studentId }: CommunicationTabProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const query = useStudentCommunicationLogs(studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.communication.errorMessage')}
    >
      {(logs) => {
        type Row = (typeof logs)[number];
        const sorted = [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at));
        const columns: DataTableColumn<Row>[] = [
          {
            id: 'date',
            header: t('detail.communication.columnDate'),
            accessorFn: (log) => formatDateTime(log.created_at, config),
          },
          {
            id: 'medium',
            header: t('detail.communication.columnMedium'),
            accessorFn: (log) =>
              t(`form.preferredCommunicationOptions.${log.medium}`, { defaultValue: log.medium }),
          },
          {
            id: 'recipient',
            header: t('detail.communication.columnRecipient'),
            accessorFn: (log) => log.recipient_name,
            card: 'title',
          },
          {
            id: 'status',
            header: t('detail.communication.columnStatus'),
            accessorFn: (log) => <StatusBadge domain="communication" status={log.status} />,
            card: 'badge',
          },
        ];
        return (
          <DataTable
            tableId="student-messages"
            caption={t('detail.tabs.communication')}
            paginated={false}
            sorting={null}
            onSortingChange={() => {}}
            columns={columns}
            data={sorted}
            getRowId={(log) => log.id}
            totalCount={sorted.length}
            emptyState={{
              title: t('detail.communication.emptyMessage'),
              explanation: t('detail.communication.emptyExplanation'),
              icon: <MessageSquareIcon aria-hidden="true" />,
            }}
          />
        );
      }}
    </TabQueryState>
  );
}
