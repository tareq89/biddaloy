import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { Announcement } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

export interface SentListProps {
  rows: Announcement[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
  page: number;
  pageSize: number;
  /** All announcements, not just this page. */
  total: number;
  onPageChange: (page: number) => void;
}

/** Date, title, schools reached and who sent it, a page at a time. */
export function SentList({
  rows,
  loading,
  isFetching,
  error,
  page,
  pageSize,
  total,
  onPageChange,
}: SentListProps) {
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
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      totalCount={total}
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
