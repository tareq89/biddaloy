/**
 * [8.11.4]'s standalone Guardians list — server-side debounced search,
 * paginated, mirroring `students/index.tsx`'s own list page. `Guardian`
 * has no class/section of its own the way `Student` does, so this page
 * has no equivalent filter dropdowns — search is the only filter.
 */
import { CommunicationMedium } from '@biddaloy/shared';
import { RoutePending, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { guardiansQueryOptions, useGuardians, type Guardian } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { formatGuardianPhone } from './-format-guardian-phone';

interface GuardianFilters {
  search?: string | undefined;
  relationship?: string | undefined;
  preferred_communication?: string | undefined;
  is_primary_contact?: string | undefined;
}

const guardiansSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  relationship: z.string().optional().catch(undefined),
  preferred_communication: z.string().optional().catch(undefined),
  is_primary_contact: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // must be declared here or TanStack Router's `validateSearch` strips it
  // from the URL. This page wires no bulk actions today, but keeping the
  // key here matches every other list route's search schema.
  selected: z.string().optional().catch(undefined),
});

const SORT_FIELD_BY_COLUMN: Partial<Record<string, 'full_name' | 'created_at'>> = {
  name: 'full_name',
};

export const Route = createFileRoute('/_staff/guardians/')({
  validateSearch: guardiansSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sort: search.sort,
    order: search.order,
    search: search.search,
    relationship: search.relationship,
    preferredCommunication: search.preferred_communication,
    isPrimaryContact: search.is_primary_contact,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const sortField = deps.sort !== undefined ? SORT_FIELD_BY_COLUMN[deps.sort] : undefined;
    return Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          guardiansQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...(deps.search !== undefined ? { search: deps.search } : {}),
            ...(deps.relationship !== undefined ? { relationship: deps.relationship } : {}),
            ...(deps.preferredCommunication !== undefined
              ? { preferred_communication: deps.preferredCommunication as CommunicationMedium }
              : {}),
            ...(deps.isPrimaryContact !== undefined
              ? { is_primary_contact: deps.isPrimaryContact === 'true' }
              : {}),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('guardians'),
    ]);
  },
  pendingComponent: GuardiansListPending,
  component: GuardiansListPage,
});

function GuardiansListPage() {
  const { t } = useTranslation('guardians');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as GuardianFilters;

  const sortField = state.sorting ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;
  const guardiansQuery = useGuardians({
    page: state.page,
    limit: state.limit,
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.relationship !== undefined ? { relationship: filters.relationship } : {}),
    ...(filters.preferred_communication !== undefined
      ? {
          preferred_communication: filters.preferred_communication as CommunicationMedium,
        }
      : {}),
    ...(filters.is_primary_contact !== undefined
      ? { is_primary_contact: filters.is_primary_contact === 'true' }
      : {}),
    ...(sortField !== undefined ? { sort: sortField } : {}),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  });

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('list.searchLabel'),
      placeholder: t('list.searchLabel'),
      primary: true,
    },
    {
      kind: 'text',
      key: 'relationship',
      label: t('list.columnRelationship'),
      placeholder: t('list.columnRelationship'),
    },
    {
      kind: 'select',
      key: 'preferred_communication',
      label: t('list.columnPreferredCommunication'),
      allLabel: t('list.allPreferredCommunication'),
      options: Object.values(CommunicationMedium).map((value) => ({
        value,
        label: t(`preferredCommunicationOptions.${value}`),
      })),
    },
    {
      kind: 'checkbox',
      key: 'is_primary_contact',
      label: t('list.columnPrimaryContact'),
    },
  ];

  const columns: DataTableColumn<Guardian>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
      sortable: true,
      // [8.14.10] Row's own name is the natural card title.
      card: 'title',
    },
    {
      id: 'relationship',
      header: t('list.columnRelationship'),
      accessorFn: (row) => row.relationship,
      card: 'subtitle',
    },
    {
      id: 'phone',
      header: t('list.columnPhone'),
      accessorFn: (row) => formatGuardianPhone(row.phone, regionConfig) ?? t('list.emptyValue'),
    },
    {
      id: 'preferredCommunication',
      header: t('list.columnPreferredCommunication'),
      accessorFn: (row) => t(`preferredCommunicationOptions.${row.preferred_communication}`),
    },
    {
      id: 'linkedStudents',
      header: t('list.columnLinkedStudents'),
      accessorFn: (row) =>
        row.students.length > 0
          ? row.students.map((student) => student.full_name).join(', ')
          : t('list.emptyValue'),
    },
    {
      id: 'primaryContact',
      header: t('list.columnPrimaryContact'),
      accessorFn: (row) => (
        <StatusBadge domain="guardian" status={row.is_primary_contact ? 'PRIMARY' : 'SECONDARY'} />
      ),
      card: 'badge',
    },
    {
      id: 'actions',
      header: t('list.columnActions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => (
        <Link
          to="/guardians/$guardianId"
          params={{ guardianId: row.id }}
          data-focus-anchor={row.id}
          className="text-sm text-muted-foreground underline"
        >
          {t('list.view')}
        </Link>
      ),
    },
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <ListShell
        title={t('list.title')}
        filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
        tableId="guardians-list"
        caption={t('list.caption')}
        columns={columns}
        data={guardiansQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={guardiansQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={guardiansQuery.isLoading}
        isFetching={guardiansQuery.isFetching}
        {...(guardiansQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) => t('list.announceResults', { count, total })}
      />
    </RegionConfigProvider>
  );
}

function GuardiansListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
