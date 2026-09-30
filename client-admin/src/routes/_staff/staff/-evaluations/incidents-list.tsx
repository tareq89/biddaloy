/**
 * [28.4.1] Incidents tab: type filter (server-side) and severity filter.
 * `GET /incidents` only accepts `type`, so severity is filtered here.
 */
import type { DataTableColumn } from '@biddaloy/ui/components';
import {
  useIncidents,
  useUser,
  type Incident,
  type IncidentListFilters,
  type IncidentSeverity,
  type IncidentType,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';

const TYPES: IncidentType[] = ['BEHAVIOUR', 'ABSENCE', 'COMPLAINT', 'COMMENDATION', 'OTHER'];
const SEVERITIES: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

function StaffName({ userId }: { userId: string }) {
  const { data } = useUser(userId);
  return <>{data?.full_name ?? '…'}</>;
}

export function IncidentsList() {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 1000 });
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
      accessorFn: (row) => t(`incident.severities.${row.severity}`),
      card: 'badge',
    },
    {
      id: 'date',
      header: t('incident.columnDate'),
      accessorFn: (row) => formatDate(new Date(row.occurredOn), regionConfig),
    },
    {
      id: 'description',
      header: t('incident.columnDescription'),
      accessorFn: (row) => row.description,
    },
  ];

  return (
    <ListShell
      title={t('incident.title')}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      tableId="incidents-list"
      caption={t('incident.title')}
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
      loadingMessage={t('incident.loading')}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('incident.loadError') } : {})}
      emptyMessage={t('incident.empty')}
    />
  );
}
