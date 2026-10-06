import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import type { SchoolSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { PlusIcon } from 'lucide-react';

import { trialDaysLeft } from './-detail/trial-card';

/**
 * Presentational half of `index.tsx`'s list page — pulled out so it can be
 * storied (`-schools-list-view.stories.tsx`) without a live `useSchools()`
 * query. The list is small and fully loaded, so it is unpaginated (D19).
 */
export interface SchoolsListViewProps {
  schools: SchoolSummary[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
  search: string;
  onSearchChange: (value: string) => void;
  /** URL-backed trial filter (`?trial=`); absent = any school. */
  trial?: 'active' | 'expired';
  onTrialChange?: (value: 'active' | 'expired' | undefined) => void;
  onNew: () => void;
}

export function SchoolsListView({
  schools,
  loading,
  isFetching,
  error,
  search,
  onSearchChange,
  trial,
  onTrialChange,
  onNew,
}: SchoolsListViewProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();

  const columns: DataTableColumn<SchoolSummary>[] = [
    {
      id: 'name',
      header: t('schools.columnName'),
      accessorFn: (row) => <span className="font-medium">{row.name}</span>,
      card: 'title',
    },
    {
      id: 'slug',
      header: t('schools.columnSlug'),
      accessorFn: (row) => row.slug,
      card: 'subtitle',
    },
    {
      id: 'status',
      header: t('schools.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.status === 'ACTIVE' ? 'success' : 'warning'}
          label={t(`schools.status.${row.status}`)}
        />
      ),
      card: 'badge',
    },
    {
      id: 'trial',
      header: t('trial.column'),
      accessorFn: (row) => {
        if (!row.trial_ends_at) return null;
        const days = trialDaysLeft(row.trial_ends_at);
        return days > 0
          ? t('trial.daysLeft', { count: days, days: formatNumber(days, config) })
          : t('trial.ended');
      },
      card: 'subtitle',
    },
    {
      id: 'created_at',
      header: t('schools.columnCreated'),
      accessorFn: (row) => formatDate(row.created_at, config),
      card: 'subtitle',
    },
  ];

  return (
    <ListShell
      title={t('schools.title')}
      subtitle={t('schools.caption')}
      tableId="platform-schools-list"
      caption={t('schools.tableCaption')}
      columns={columns}
      data={schools}
      getRowId={(row) => row.id}
      paginated={false}
      totalCount={schools.length}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('schools.viewAction', { name: row.name }),
          to: `/schools/${row.id}`,
        },
      ]}
      sorting={null}
      onSortingChange={() => {}}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('schools.emptyMessage'),
        explanation: t('schools.emptyExplanation'),
        kind: 'no-results',
      }}
      actions={[
        {
          id: 'new',
          label: t('schools.newAction'),
          icon: <PlusIcon aria-hidden="true" />,
          priority: 'primary',
          onClick: onNew,
        },
      ]}
      filters={{
        fields: [
          {
            kind: 'text',
            key: 'q',
            label: t('schools.searchLabel'),
            placeholder: t('schools.searchPlaceholder'),
            primary: true,
          },
          {
            kind: 'select',
            key: 'trial',
            label: t('trial.filterLabel'),
            allLabel: t('trial.filterAll'),
            options: [
              { value: 'active', label: t('trial.filterActive') },
              { value: 'expired', label: t('trial.filterEnded') },
            ],
          },
        ],
        values: { q: search, ...(trial ? { trial } : {}) },
        onChange: (patch) => {
          if ('q' in patch) onSearchChange(patch.q ?? '');
          if ('trial' in patch) {
            const next = patch.trial;
            onTrialChange?.(next === 'active' || next === 'expired' ? next : undefined);
          }
        },
      }}
      announceResults={(count, total) => t('schools.announceResults', { count: count, total })}
    />
  );
}
