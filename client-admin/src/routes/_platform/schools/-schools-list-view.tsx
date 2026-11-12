import { StatusBadge, type DataTableColumn, type DataTableSort } from '@biddaloy/ui/components';
import type { PlatformSchoolSearchItem } from '@biddaloy/ui/hooks';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, formatRelativeAge } from '@biddaloy/ui/utils';
import { LogInIcon, PlusIcon } from 'lucide-react';

/**
 * Presentational half of `index.tsx` (mockup "Schools list"), storied on its own. Filters and
 * sort live in the URL; the server returns one page of at most 100 schools.
 */
export interface SchoolsListFilterValues {
  q?: string | undefined;
  status?: string | undefined;
  trial?: string | undefined;
}

export interface SchoolsListViewProps {
  schools: PlatformSchoolSearchItem[];
  total: number;
  loading: boolean;
  isFetching: boolean;
  error?: string;
  filters: SchoolsListFilterValues;
  onFiltersChange: (patch: Record<string, string | null>) => void;
  sorting: DataTableSort | null;
  onSortingChange: (sorting: DataTableSort | null) => void;
  onNew: () => void;
  onLoginAs: (school: PlatformSchoolSearchItem) => void;
}

export function SchoolsListView({
  schools,
  total,
  loading,
  isFetching,
  error,
  filters,
  onFiltersChange,
  sorting,
  onSortingChange,
  onNew,
  onLoginAs,
}: SchoolsListViewProps) {
  const { t } = useTranslation('platform');
  const { t: tl } = useTranslation('schoolsList');
  const { locale } = useLocale();
  const config = useRegionConfig();

  const columns: DataTableColumn<PlatformSchoolSearchItem>[] = [
    {
      id: 'name',
      header: t('schools.columnName'),
      accessorFn: (row) => <span className="font-medium">{row.name}</span>,
      sortable: true,
      card: 'title',
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
      id: 'students',
      header: tl('columnStudents'),
      accessorFn: (row) => formatNumber(row.studentCount, config),
      sortable: true,
      align: 'end',
    },
    {
      id: 'lastActivity',
      header: tl('columnLastActive'),
      accessorFn: (row) =>
        row.lastActivityAt
          ? formatRelativeAge(Date.parse(row.lastActivityAt), locale)
          : tl('never'),
      sortable: true,
    },
    {
      id: 'trialEnd',
      header: tl('columnTrialEnd'),
      accessorFn: (row) => (row.trialEndsAt ? formatDate(row.trialEndsAt, config) : tl('noTrial')),
      sortable: true,
    },
  ];

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'q',
      label: tl('searchLabel'),
      placeholder: tl('searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'status',
      label: tl('filterStatus'),
      allLabel: tl('allStatuses'),
      options: (['ACTIVE', 'SUSPENDED'] as const).map((value) => ({
        value,
        label: t(`schools.status.${value}`),
      })),
    },
    {
      kind: 'select',
      key: 'trial',
      label: tl('filterTrial'),
      allLabel: tl('allTrials'),
      options: (['active', 'expired'] as const).map((value) => ({
        value,
        label: tl(`trial.${value}`),
      })),
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
      totalCount={total}
      rowActions={(row) => [
        {
          intent: 'edit',
          label: tl('loginAsFor', { name: row.name }),
          shortLabel: tl('loginAs'),
          display: 'text',
          icon: <LogInIcon className="size-4" aria-hidden="true" />,
          onClick: () => onLoginAs(row),
        },
        {
          intent: 'view',
          label: t('schools.viewAction', { name: row.name }),
          to: `/schools/${row.id}`,
        },
      ]}
      sorting={sorting}
      onSortingChange={onSortingChange}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('schools.emptyMessage'),
        explanation: tl('emptyExplanation'),
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
        fields,
        values: {
          q: filters.q ?? '',
          status: filters.status ?? '',
          trial: filters.trial ?? '',
        },
        onChange: (patch) => onFiltersChange(patch),
      }}
      announceResults={(count, all) => t('schools.announceResults', { count, total: all })}
    />
  );
}
