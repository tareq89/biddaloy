/**
 * [28.4.1] ACR register tab: year + status filters, table on desktop and
 * cards on phone (`DataTable`'s own `card` roles, D23). The server returns
 * the whole register (no paging), so rows are shown in one page.
 */
import type { DataTableColumn } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAcrAssessments,
  useUser,
  type AcrAssessment,
  type AcrListFilters,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

const STATUSES = ['INCOMPLETE', 'COMPLETED'] as const;

function StaffName({ userId }: { userId: string }) {
  const { data } = useUser(userId);
  return <>{data?.full_name ?? '…'}</>;
}

export function AcrRegister() {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 1000 });
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
      accessorFn: (row) => t(`acr.status.${row.status}`),
      card: 'badge',
    },
    {
      id: 'total',
      header: t('acr.register.columnTotal'),
      accessorFn: (row) => row.total ?? '—',
    },
    {
      id: 'completed',
      header: t('acr.register.columnCompletedAt'),
      accessorFn: (row) =>
        row.completed_at ? formatDate(new Date(row.completed_at), regionConfig) : '—',
    },
    {
      id: 'actions',
      header: t('acr.register.open'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => (
        <Link
          to="/staff/$userId/acr/$assessmentId"
          params={{ userId: row.user_id, assessmentId: row.id }}
          data-focus-anchor={row.id}
          className="text-sm text-muted-foreground underline"
        >
          {t('acr.register.open')}
        </Link>
      ),
    },
  ];

  const rows = query.data ?? [];
  return (
    <ListShell
      title={t('acr.register.title')}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      tableId="acr-register"
      caption={t('acr.register.title')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      page={1}
      pageSize={Math.max(rows.length, 1)}
      totalCount={rows.length}
      onPageChange={() => undefined}
      loading={query.isLoading}
      loadingMessage={t('acr.register.loading')}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('acr.register.errorMessage') } : {})}
      emptyMessage={t('acr.register.empty')}
    />
  );
}
