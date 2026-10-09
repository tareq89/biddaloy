import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useAuditLogsByEntity } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import { HistoryIcon } from 'lucide-react';

import { TabQueryState } from './tab-query-state';

export interface ActivityTabProps {
  studentId: string;
}

export function ActivityTab({ studentId }: ActivityTabProps) {
  const { t } = useTranslation('students');
  // The route loader preloads `auditLogs`, so the action labels resolve without suspending.
  const { t: tAudit } = useTranslation('auditLogs');
  const config = useRegionConfig();
  const query = useAuditLogsByEntity('Student', studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.activity.errorMessage')}
    >
      {(auditLogsPage) => {
        type Row = (typeof auditLogsPage.data)[number];
        const columns: DataTableColumn<Row>[] = [
          {
            id: 'date',
            header: t('detail.activity.columnDate'),
            accessorFn: (log) => formatDateTime(log.created_at, config),
          },
          {
            id: 'action',
            header: t('detail.activity.columnAction'),
            accessorFn: (log) => tAudit(`actions.${log.action}`, { defaultValue: log.action }),
            card: 'title',
          },
          {
            id: 'by',
            header: t('detail.activity.columnBy'),
            accessorFn: (log) => log.performed_by_name ?? '—',
            card: 'subtitle',
          },
        ];
        return (
          <DataTable
            tableId="student-activity"
            caption={t('detail.tabs.activity')}
            paginated={false}
            sorting={null}
            onSortingChange={() => {}}
            columns={columns}
            data={auditLogsPage.data}
            getRowId={(log) => log.id}
            totalCount={auditLogsPage.data.length}
            emptyState={{
              title: t('detail.activity.emptyMessage'),
              explanation: t('detail.activity.emptyExplanation'),
              icon: <HistoryIcon aria-hidden="true" />,
            }}
          />
        );
      }}
    </TabQueryState>
  );
}
