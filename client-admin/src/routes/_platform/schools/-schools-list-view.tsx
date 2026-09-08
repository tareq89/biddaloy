import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import type { SchoolSummary } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import type { ReactNode } from 'react';

/**
 * Presentational half of `index.tsx`'s list page — pulled out so it can be
 * storied (`-schools-list-view.stories.tsx`) without a router or a live
 * `useSchools()` query. `renderName` renders each row's name cell — a
 * render prop rather than this component doing it directly, since the
 * real route wraps it in a TanStack `Link` (needs a router context
 * Storybook doesn't have) while stories use a plain `<span>`.
 */
export interface SchoolsListViewProps {
  schools: SchoolSummary[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
  search: string;
  onSearchChange: (value: string) => void;
  renderName: (school: SchoolSummary) => ReactNode;
}

export function SchoolsListView({
  schools,
  loading,
  isFetching,
  error,
  search,
  onSearchChange,
  renderName,
}: SchoolsListViewProps) {
  const { t } = useTranslation('platform');

  const columns: DataTableColumn<SchoolSummary>[] = [
    {
      id: 'name',
      header: t('schools.columnName'),
      accessorFn: (row) => renderName(row),
    },
    {
      id: 'slug',
      header: t('schools.columnSlug'),
      accessorFn: (row) => row.slug,
    },
    {
      id: 'status',
      header: t('schools.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="school" status={row.status} />,
    },
    {
      id: 'created_at',
      header: t('schools.columnCreated'),
      accessorFn: (row) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  return (
    <ListShell
      title={t('schools.title')}
      tableId="platform-schools-list"
      caption={t('schools.caption')}
      columns={columns}
      data={schools}
      getRowId={(row) => row.id}
      page={1}
      pageSize={schools.length || 1}
      totalCount={schools.length}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
      sorting={null}
      onSortingChange={() => {}}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyMessage={t('schools.emptyMessage')}
      filterBar={
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('schools.searchPlaceholder')}
          aria-label={t('schools.searchLabel')}
          className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
        />
      }
      announceResults={(count, total) => t('schools.announceResults', { count: count, total })}
    />
  );
}
