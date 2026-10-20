import { SCHOOL_BILLING_FILTERS } from '@biddaloy/shared';
import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import type { PlatformSchoolBilling, SchoolBillingFilter } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

/**
 * Presentational half of `index.tsx`: every school's seats and payments, with a search and the
 * three filters (expiring in 14 days, all seats used, idle). Storied on its own.
 */
export interface SubscriptionsListViewProps {
  schools: PlatformSchoolBilling[];
  /** Matches before paging, from the server. */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  isFetching: boolean;
  error?: string;
  search: string;
  onSearchChange: (value: string) => void;
  filter?: SchoolBillingFilter | undefined;
  onFilterChange: (value: SchoolBillingFilter | undefined) => void;
  onOpen: (school: PlatformSchoolBilling) => void;
}

const FILTER_KEY = {
  expiring: 'filterExpiring',
  exhausted: 'filterExhausted',
  idle: 'filterIdle',
} as const;

function statusOf(row: PlatformSchoolBilling): 'ACTIVE' | 'SUSPENDED' | 'DELETED' {
  return row.deleted ? 'DELETED' : row.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED';
}

export function SubscriptionsListView({
  schools,
  total,
  page,
  pageSize,
  onPageChange,
  loading,
  isFetching,
  error,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  onOpen,
}: SubscriptionsListViewProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();

  const columns: DataTableColumn<PlatformSchoolBilling>[] = [
    {
      id: 'name',
      header: t('subscriptions.columnName'),
      accessorFn: (row) => <span className="font-medium">{row.name}</span>,
      card: 'title',
    },
    {
      id: 'status',
      header: t('subscriptions.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={statusOf(row) === 'ACTIVE' ? 'success' : 'warning'}
          label={t(`subscriptions.status.${statusOf(row)}`)}
        />
      ),
      card: 'badge',
    },
    {
      id: 'seats',
      header: t('subscriptions.columnSeats'),
      accessorFn: (row) =>
        `${formatNumber(row.seats_used, config)} / ${formatNumber(row.seats_entitled, config)}`,
      align: 'end',
      card: 'field',
    },
    {
      id: 'paid_until',
      header: t('subscriptions.columnPaidUntil'),
      accessorFn: (row) =>
        row.paid_until ? formatDate(row.paid_until, config) : t('subscriptions.neverPaid'),
      card: 'field',
    },
    {
      id: 'pending',
      header: t('subscriptions.columnPending'),
      accessorFn: (row) => formatNumber(row.pending_orders, config),
      align: 'end',
      card: 'field',
    },
  ];

  return (
    <ListShell
      title={t('subscriptions.title')}
      subtitle={t('subscriptions.caption')}
      tableId="platform-subscriptions-list"
      caption={t('subscriptions.tableCaption')}
      columns={columns}
      data={schools}
      getRowId={(row) => row.id}
      page={page}
      pageSize={pageSize}
      totalCount={total}
      onPageChange={onPageChange}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('subscriptions.viewAction', { name: row.name }),
          onClick: () => onOpen(row),
        },
      ]}
      sorting={null}
      onSortingChange={() => {}}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('subscriptions.emptyMessage'),
        explanation: t('subscriptions.emptyExplanation'),
        kind: 'no-results',
      }}
      filters={{
        fields: [
          {
            kind: 'text',
            key: 'q',
            label: t('subscriptions.searchLabel'),
            placeholder: t('subscriptions.searchPlaceholder'),
            primary: true,
          },
          {
            kind: 'select',
            key: 'filter',
            label: t('subscriptions.filterLabel'),
            allLabel: t('subscriptions.filterAll'),
            options: SCHOOL_BILLING_FILTERS.map((f) => ({
              value: f,
              label: t(`subscriptions.${FILTER_KEY[f]}`),
            })),
          },
        ],
        values: { q: search, ...(filter ? { filter } : {}) },
        onChange: (patch) => {
          if ('q' in patch) onSearchChange(patch.q ?? '');
          if ('filter' in patch) {
            const next = SCHOOL_BILLING_FILTERS.find((f) => f === patch.filter);
            onFilterChange(next);
          }
        },
      }}
      announceResults={(count, total) => t('subscriptions.announceResults', { count, total })}
    />
  );
}
