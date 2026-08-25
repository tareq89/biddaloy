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
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useCurrentUserId,
  useHasPermission,
  usersQueryOptions,
  useUsers,
  type StaffUser,
  type UserRoleFilter,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { AddUserDialog } from './-add-user-dialog';
import { formatStaffPhone } from './-format-staff-phone';
import { PromoteTeacherDialog } from './-promote-teacher-dialog';
import { RemoveMemberDialog } from './-remove-member-dialog';

interface StaffFilters {
  search?: string | undefined;
  role?: string | undefined;
}

/** The sentinel the role `Select` uses for "no filter" — Radix Select
 * items can't carry an empty-string value. */
const ALL_ROLES = 'ALL';

const staffSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  role: z.string().optional().catch(undefined),
  // Reserved row-selection key — same reasoning as `guardians/index.tsx`.
  selected: z.string().optional().catch(undefined),
});

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
    search: search.search,
    role: search.role,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const role = toRoleParam(deps.role);
    return queryClient.ensureQueryData(
      usersQueryOptions({
        page: deps.page,
        limit: deps.limit,
        ...(deps.search !== undefined ? { search: deps.search } : {}),
        ...(role !== undefined ? { role } : {}),
      }),
    );
  },
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

  // Same local-echo + 300ms-delayed URL write as `guardians/index.tsx`.
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

  const roleParam = toRoleParam(filters.role);
  const usersQuery = useUsers({
    page: state.page,
    limit: state.limit,
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(roleParam !== undefined ? { role: roleParam } : {}),
  });

  const columns: DataTableColumn<StaffUser>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
    },
    {
      id: 'email',
      header: t('list.columnEmail'),
      accessorFn: (row) => row.email || t('list.emptyValue'),
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
    },
    {
      id: 'joined',
      header: t('list.columnJoined'),
      accessorFn: (row) => formatDate(new Date(row.created_at), regionConfig),
    },
    {
      id: 'actions',
      header: t('list.columnActions'),
      pinned: true,
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
        filterBar={
          <>
            <Input
              aria-label={t('list.searchLabel')}
              placeholder={t('list.searchLabel')}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <Select
              value={filters.role ?? ALL_ROLES}
              onValueChange={(value) =>
                actions.setFilters({
                  ...filters,
                  role: value === ALL_ROLES ? undefined : value,
                } as Record<string, string>)
              }
            >
              <SelectTrigger aria-label={t('list.roleFilterLabel')}>
                <SelectValue placeholder={t('list.roleFilterLabel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ROLES}>{t('list.roleFilterAll')}</SelectItem>
                {STAFF_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        tableId="staff-list"
        caption={t('list.caption')}
        columns={columns}
        data={usersQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {
          // No sortable columns — `GET /users` accepts no sort param.
        }}
        page={state.page}
        pageSize={state.limit}
        totalCount={usersQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        loading={usersQuery.isLoading}
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
