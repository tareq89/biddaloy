/**
 * [28.4.1] Incidents tab: type filter (server-side) and severity filter.
 * `GET /incidents` only accepts `type`, so severity is filtered here.
 */
import {
  DataTable,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
  type StatusTone,
} from '@biddaloy/ui/components';
import {
  useIncidents,
  useUser,
  type Incident,
  type IncidentListFilters,
  type IncidentSeverity,
  type IncidentType,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, parseDate } from '@biddaloy/ui/utils';

const TYPES: IncidentType[] = ['BEHAVIOUR', 'ABSENCE', 'COMPLAINT', 'COMMENDATION', 'OTHER'];
const SEVERITIES: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
const SEVERITY_TONE: Record<IncidentSeverity, StatusTone> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

function StaffName({ userId }: { userId: string }) {
  const { data } = useUser(userId);
  return data ? (
    <span className="font-medium">{data.full_name}</span>
  ) : (
    <Skeleton className="h-4 w-24" />
  );
}

export function IncidentsList() {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState();
  const type = TYPES.find((v) => v === state.filters.type);
  const severity = SEVERITIES.find((v) => v === state.filters.severity);
  const filters: IncidentListFilters = type ? { type } : {};
  const query = useIncidents(filters);
  const rows = (query.data ?? []).filter((row) => !severity || row.severity === severity);

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'type',
      label: t('incident.filterType'),
      allLabel: t('incident.allTypes'),
      options: TYPES.map((v) => ({ value: v, label: t(`incident.types.${v}`) })),
    },
    {
      kind: 'select',
      key: 'severity',
      label: t('incident.filterSeverity'),
      allLabel: t('incident.allSeverities'),
      options: SEVERITIES.map((v) => ({ value: v, label: t(`incident.severities.${v}`) })),
    },
  ];

  const columns: DataTableColumn<Incident>[] = [
    {
      id: 'staff',
      header: t('incident.columnStaff'),
      accessorFn: (row) => <StaffName userId={row.staffId} />,
      card: 'title',
    },
    {
      id: 'type',
      header: t('incident.columnType'),
      accessorFn: (row) => t(`incident.types.${row.type}`),
      card: 'subtitle',
    },
    {
      id: 'severity',
      header: t('incident.columnSeverity'),
      accessorFn: (row) => (
        <StatusBadge
          tone={SEVERITY_TONE[row.severity]}
          label={t(`incident.severities.${row.severity}`)}
        />
      ),
      card: 'badge',
    },
    {
      id: 'date',
      header: t('incident.columnDate'),
      accessorFn: (row) => formatDate(parseDate(row.occurredOn), regionConfig),
    },
    {
      id: 'description',
      header: t('incident.columnDescription'),
      accessorFn: (row) => (
        <span className="block truncate" title={row.description}>
          {row.description}
        </span>
      ),
    },
  ];

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
        tableId="incidents-list"
        caption={t('incident.title')}
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
        loading={query.isLoading}
        loadingMessage={t('incident.loading')}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('incident.loadError') } : {})}
        emptyState={{ title: t('incident.emptyTitle'), explanation: t('incident.empty') }}
      />
    </section>
  );
}
