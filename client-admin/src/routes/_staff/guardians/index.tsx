/**
 * [8.11.4]'s standalone Guardians list — server-side debounced search,
 * paginated, mirroring `students/index.tsx`'s own list page. `Guardian`
 * has no class/section of its own the way `Student` does, so this page
 * has no equivalent filter dropdowns — search is the only filter.
 */
import { Input, RoutePending, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { guardiansQueryOptions, useGuardians, type Guardian } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { formatGuardianPhone } from './-format-guardian-phone';

interface GuardianFilters {
  search?: string | undefined;
}

const guardiansSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // must be declared here or TanStack Router's `validateSearch` strips it
  // from the URL. This page wires no bulk actions today, but keeping the
  // key here matches every other list route's search schema.
  selected: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/guardians/')({
  validateSearch: guardiansSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    search: search.search,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          guardiansQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...(deps.search !== undefined ? { search: deps.search } : {}),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('guardians'),
    ]),
  pendingComponent: GuardiansListPending,
  component: GuardiansListPage,
});

function GuardiansListPage() {
  const { t } = useTranslation('guardians');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as GuardianFilters;

  // Same debounce shape as `students/index.tsx`'s own search box — see
  // that file's comment for why this is a local echo state plus a
  // 300ms-delayed URL write, not a direct `onChange` -> `setFilters`.
  const [searchInput, setSearchInput] = React.useState(filters.search ?? '');
  React.useEffect(() => {
    setSearchInput(filters.search ?? '');
  }, [filters.search]);

  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      const currentFilters = filtersRef.current;
      if (searchInput === (currentFilters.search ?? '')) return;
      actionsRef.current.setFilters({
        ...currentFilters,
        search: searchInput || undefined,
      } as Record<string, string>);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const guardiansQuery = useGuardians({
    page: state.page,
    limit: state.limit,
    ...(filters.search !== undefined ? { search: filters.search } : {}),
  });

  const columns: DataTableColumn<Guardian>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
    },
    {
      id: 'relationship',
      header: t('list.columnRelationship'),
      accessorFn: (row) => row.relationship,
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
    },
    {
      id: 'actions',
      header: t('list.columnActions'),
      pinned: true,
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
        filterBar={
          <Input
            aria-label={t('list.searchLabel')}
            placeholder={t('list.searchLabel')}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        }
        tableId="guardians-list"
        caption={t('list.caption')}
        columns={columns}
        data={guardiansQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {
          // No sortable columns — the issue's ACs don't call for one, and
          // `guardiansQueryOptions` doesn't accept a `sort`/`order` param
          // the way `studentsQueryOptions` does.
        }}
        page={state.page}
        pageSize={state.limit}
        totalCount={guardiansQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        loading={guardiansQuery.isLoading}
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
