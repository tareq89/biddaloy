import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { Announcement } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

export interface SentListProps {
  rows: Announcement[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
}

/** Date, title, schools reached and who sent it. First page only (ponytail: add paging past 25). */
export function SentList({ rows, loading, isFetching, error }: SentListProps) {
  const { t } = useTranslation('platformAnnouncements');
  const config = useRegionConfig();

  const columns: DataTableColumn<Announcement>[] = [
    { id: 'title', header: t('list.columnTitle'), accessorFn: (r) => r.title, card: 'title' },
    {
      id: 'date',
      header: t('list.columnDate'),
      accessorFn: (r) => formatDateTime(r.createdAt, config),
      card: 'field',
    },
    {
      id: 'schools',
      header: t('list.columnSchools'),
      accessorFn: (r) =>
        t('list.schoolsOf', { done: r.schoolsSucceeded, total: r.schoolsTargeted }),
      card: 'field',
    },
    {
      id: 'by',
      header: t('list.columnBy'),
      accessorFn: (r) => r.createdByName ?? '-',
      card: 'field',
    },
  ];

  return (
    <DataTable
      tableId="platform-announcements"
      caption={t('list.caption')}
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      sorting={null}
      onSortingChange={() => {}}
      paginated={false}
      totalCount={rows.length}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('list.emptyTitle'),
        explanation: t('list.emptyExplanation'),
        kind: 'no-results',
      }}
      announceResults={(shown) => t('list.announceResults', { count: shown })}
    />
  );
}
