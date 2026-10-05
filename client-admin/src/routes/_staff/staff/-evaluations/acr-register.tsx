/**
 * [28.4.1] ACR register tab: year + status filters, table on desktop and
 * cards on phone (`DataTable`'s own `card` roles, D23). The server returns
 * the whole register (no paging), so it is paged client-side (25 a page).
 */
import { DataTable, Skeleton, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAcrAssessments,
  useUser,
  type AcrAssessment,
  type AcrListFilters,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

const STATUSES = ['INCOMPLETE', 'COMPLETED'] as const;

function StaffName({ userId }: { userId: string }) {
  const { data } = useUser(userId);
  return data ? (
    <span className="font-medium">{data.full_name}</span>
  ) : (
    <Skeleton className="h-4 w-24" />
  );
}

export function AcrRegister() {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState();
  const years = useAcademicYears({}).data?.data ?? [];
  const status = STATUSES.find((s) => s === state.filters.status);
  const filters: AcrListFilters = {
    ...(state.filters.year ? { year: state.filters.year } : {}),
    ...(status ? { status } : {}),
  };
  const query = useAcrAssessments(filters);
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? '—';

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'year',
      label: t('acr.register.yearFilter'),
      allLabel: t('acr.register.allYears'),
      options: years.map((y) => ({ value: y.id, label: y.name })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('acr.register.statusFilter'),
      allLabel: t('acr.register.allStatuses'),
      options: STATUSES.map((s) => ({ value: s, label: t(`acr.status.${s}`) })),
    },
  ];

  const columns: DataTableColumn<AcrAssessment>[] = [
    {
      id: 'staff',
      header: t('acr.register.columnStaff'),
      accessorFn: (row) => <StaffName userId={row.user_id} />,
      card: 'title',
    },
    {
      id: 'year',
      header: t('acr.register.columnYear'),
      accessorFn: (row) => yearName(row.academic_year_id),
      card: 'subtitle',
    },
    {
      id: 'status',
      header: t('acr.register.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.status === 'COMPLETED' ? 'success' : 'warning'}
          label={t(`acr.status.${row.status}`)}
        />
      ),
      card: 'badge',
    },
    {
      id: 'total',
      header: t('acr.register.columnTotal'),
      align: 'end',
      accessorFn: (row) => (row.total === null ? '—' : formatNumber(row.total, regionConfig)),
    },
    {
      id: 'completed',
      header: t('acr.register.columnCompletedAt'),
      accessorFn: (row) =>
        row.completed_at ? formatDate(new Date(row.completed_at), regionConfig) : '—',
    },
  ];

  const rows = query.data ?? [];
  const pageRows = rows.slice((state.page - 1) * state.limit, state.page * state.limit);
  return (
    <section className="space-y-4">
      <FilterBar
        fields={filterFields}
        values={state.filters}
        onChange={actions.setFilters}
        resultCount={rows.length}
      />
      <DataTable
        tableId="acr-register"
        caption={t('acr.register.title')}
        columns={columns}
        data={pageRows}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={state.page}
        pageSize={state.limit}
        totalCount={rows.length}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('acr.register.open'),
            to: `/staff/${row.user_id}/acr/${row.id}`,
            'data-focus-anchor': row.id,
          },
        ]}
        loading={query.isLoading}
        loadingMessage={t('acr.register.loading')}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('acr.register.errorMessage') } : {})}
        emptyState={{ title: t('acr.register.emptyTitle'), explanation: t('acr.register.empty') }}
      />
    </section>
  );
}
