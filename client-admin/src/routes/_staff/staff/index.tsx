/**
 * [8.11.8]'s Staff list — every user with a membership in the active
 * school, filterable by role (shared `UserRole` enum via `STAFF_ROLES`)
 * and server-side debounced search, mirroring `guardians/index.tsx`.
 * "Add user" creates an account + membership; "Promote to teacher" is
 * deliberately framed around picking an **existing member** — the server
 * documents `POST /teachers` as promotion, never as creating a second
 * kind of person.
 */
import { Permission, STAFF_ROLES } from '@biddaloy/shared';
import { Button, RoutePending, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useCurrentUserId,
  useHasPermission,
  usersQueryOptions,
  useUsers,
  type StaffUser,
  type UserRoleFilter,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { AddUserDialog } from './-add-user-dialog';
import { formatStaffPhone } from './-format-staff-phone';
import { PromoteTeacherDialog } from './-promote-teacher-dialog';
import { RemoveMemberDialog } from './-remove-member-dialog';

interface StaffFilters {
  search?: string | undefined;
  role?: string | undefined;
}

const staffSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  role: z.string().optional().catch(undefined),
  // Reserved row-selection key — same reasoning as `guardians/index.tsx`.
  selected: z.string().optional().catch(undefined),
});

const SORT_FIELD_BY_COLUMN: Partial<
  Record<string, 'full_name' | 'email' | 'joined_at' | 'status'>
> = {
  name: 'full_name',
  email: 'email',
  joined: 'joined_at',
  status: 'status',
};

function toRoleParam(role: string | undefined): UserRoleFilter | undefined {
  return role !== undefined && (STAFF_ROLES as readonly string[]).includes(role)
    ? (role as UserRoleFilter)
    : undefined;
}

export const Route = createFileRoute('/_staff/staff/')({
  validateSearch: staffSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sort: search.sort,
    order: search.order,
    search: search.search,
    role: search.role,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const role = toRoleParam(deps.role);
    const sortField = deps.sort !== undefined ? SORT_FIELD_BY_COLUMN[deps.sort] : undefined;
    return Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          usersQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...(deps.search !== undefined ? { search: deps.search } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('staff'),
    ]);
  },
  pendingComponent: StaffListPending,
  component: StaffListPage,
});

function StaffListPage() {
  const { t } = useTranslation('staff');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as StaffFilters;
  const currentUserId = useCurrentUserId();

  const canCreate = useHasPermission(Permission.USER_CREATE);
  const canRemove = useHasPermission(Permission.MEMBER_REMOVE);

  const [addUserOpen, setAddUserOpen] = React.useState(false);
  const [promoteOpen, setPromoteOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<StaffUser | null>(null);

  const roleParam = toRoleParam(filters.role);
  const sortField = state.sorting ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;
  const usersQuery = useUsers({
    page: state.page,
    limit: state.limit,
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(roleParam !== undefined ? { role: roleParam } : {}),
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
      kind: 'select',
      key: 'role',
      label: t('list.roleFilterLabel'),
      allLabel: t('list.roleFilterAll'),
      options: STAFF_ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) })),
    },
  ];

  const columns: DataTableColumn<StaffUser>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
      sortable: true,
      // [8.14.10] Row's own name is the natural card title.
      card: 'title',
    },
    {
      id: 'email',
      header: t('list.columnEmail'),
      accessorFn: (row) => row.email || t('list.emptyValue'),
      sortable: true,
      card: 'subtitle',
    },
    {
      id: 'phone',
      header: t('list.columnPhone'),
      accessorFn: (row) => formatStaffPhone(row.phone, regionConfig) ?? t('list.emptyValue'),
    },
    {
      id: 'role',
      header: t('list.columnRole'),
      accessorFn: (row) => (row.role !== null ? t(`roles.${row.role}`) : t('list.emptyValue')),
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="user" status={row.status} />,
      sortable: true,
      card: 'badge',
    },
    {
      id: 'joined',
      header: t('list.columnJoined'),
      accessorFn: (row) => formatDate(new Date(row.created_at), regionConfig),
      sortable: true,
    },
    {
      id: 'actions',
      header: t('list.columnActions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => (
        <div className="flex items-center gap-2">
          <Link
            to="/staff/$userId"
            params={{ userId: row.id }}
            data-focus-anchor={row.id}
            className="text-sm text-muted-foreground underline"
          >
            {t('list.view')}
          </Link>
          {canRemove && (
            <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(row)}>
              {t('detail.actions.remove')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canCreate ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPromoteOpen(true)}>
                {t('list.promoteTeacher')}
              </Button>
              <Button onClick={() => setAddUserOpen(true)}>{t('list.addUser')}</Button>
            </div>
          ) : undefined
        }
        filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
        tableId="staff-list"
        caption={t('list.caption')}
        columns={columns}
        data={usersQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={usersQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={usersQuery.isLoading}
        isFetching={usersQuery.isFetching}
        {...(usersQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) => t('list.announceResults', { count, total })}
      />

      <AddUserDialog open={addUserOpen} onOpenChange={setAddUserOpen} />
      <PromoteTeacherDialog open={promoteOpen} onOpenChange={setPromoteOpen} />
      {removeTarget !== null && (
        <RemoveMemberDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          user={removeTarget}
          isSelf={removeTarget.id === currentUserId}
        />
      )}
    </RegionConfigProvider>
  );
}

function StaffListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
