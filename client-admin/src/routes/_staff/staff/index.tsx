/**
 * [8.11.8]'s Staff list — every user with a membership in the active
 * school, filterable by role (shared `UserRole` enum via `STAFF_ROLES`)
 * and server-side debounced search, mirroring `guardians/index.tsx`.
 * "Add user" creates an account + membership; "Promote to teacher" is
 * deliberately framed around picking an **existing member** — the server
 * documents `POST /teachers` as promotion, never as creating a second
 * kind of person.
 */
import { Permission, STAFF_ROLES, UserStatus } from '@biddaloy/shared';
import type { InvitationStatus } from '@biddaloy/shared';
import {
  Button,
  RoutePending,
  StatusBadge,
  statusLabelKey,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  designationTitle,
  useCurrentUserId,
  useDesignations,
  useHasPermission,
  usersQueryOptions,
  useUsers,
  type StaffUser,
  type UserRoleFilter,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { IdCardIcon, PlusIcon, UserRoundCheckIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { AddUserDialog } from './-add-user-dialog';
import { EditUserDialog } from './-edit-user-dialog';
import { formatStaffPhone } from './-format-staff-phone';
import { PromoteTeacherDialog } from './-promote-teacher-dialog';
import { RemoveMemberDialog } from './-remove-member-dialog';

/** [12.6] Every value `deriveInvitationStatus` can produce — a plain
 * array, not `Object.values`, because `InvitationStatus` is a type alias
 * (`shared/src/types/auth.types.ts`), not an enum with runtime members. */
const INVITATION_STATUS_VALUES: InvitationStatus[] = [
  'NONE',
  'PENDING',
  'EXPIRED',
  'REVOKED',
  'ACTIVATED',
];

interface StaffFilters {
  search?: string | undefined;
  role?: string | undefined;
  status?: string | undefined;
  invitation_status?: string | undefined;
  designation_id?: string | undefined;
  joined_from?: string | undefined;
  joined_to?: string | undefined;
}

const staffSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  role: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  invitation_status: z.string().optional().catch(undefined),
  // [23.12] The nav-tree gap: "Staff is ONE register... with staff-type
  // filter and designations" — a `Designation` (23.2) id, alongside the
  // existing `role` filter, not replacing it.
  designation_id: z.string().uuid().optional().catch(undefined),
  joined_from: z.string().optional().catch(undefined),
  joined_to: z.string().optional().catch(undefined),
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

function toStatusParam(status: string | undefined): UserStatus | undefined {
  return status !== undefined && (Object.values(UserStatus) as string[]).includes(status)
    ? (status as UserStatus)
    : undefined;
}

function toInvitationStatusParam(status: string | undefined): InvitationStatus | undefined {
  return status !== undefined && (INVITATION_STATUS_VALUES as string[]).includes(status)
    ? (status as InvitationStatus)
    : undefined;
}

export const Route = createFileRoute('/_staff/staff/')({
  validateSearch: staffSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 25,
    sort: search.sort,
    order: search.order,
    search: search.search,
    role: search.role,
    status: search.status,
    invitationStatus: search.invitation_status,
    designationId: search.designation_id,
    joinedFrom: search.joined_from,
    joinedTo: search.joined_to,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const role = toRoleParam(deps.role);
    const status = toStatusParam(deps.status);
    const invitationStatus = toInvitationStatusParam(deps.invitationStatus);
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
            ...(status !== undefined ? { status } : {}),
            ...(invitationStatus !== undefined ? { invitation_status: invitationStatus } : {}),
            ...(deps.designationId !== undefined ? { designation_id: deps.designationId } : {}),
            ...(deps.joinedFrom !== undefined ? { joined_from: deps.joinedFrom } : {}),
            ...(deps.joinedTo !== undefined ? { joined_to: deps.joinedTo } : {}),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('staff'),
    ]);
  },
  pendingComponent: StaffListPending,
  component: StaffListPage,
});

function StaffListPage() {
  const { t } = useTranslation('staff');
  const { locale } = useLocale();
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState();
  const filters = state.filters as StaffFilters;
  const currentUserId = useCurrentUserId();

  const canCreate = useHasPermission(Permission.USER_CREATE);
  const canUpdate = useHasPermission(Permission.USER_UPDATE);
  const canRemove = useHasPermission(Permission.MEMBER_REMOVE);
  // D18: a staff card exposes HR data, so printing needs both permissions.
  const canPrintDocuments = useHasPermission(Permission.DOCUMENT_PRINT);
  const canReadHr = useHasPermission(Permission.STAFF_HR_READ);
  const canPrint = canPrintDocuments && canReadHr;
  const navigate = useNavigate();

  const [addUserOpen, setAddUserOpen] = React.useState(false);
  const [promoteOpen, setPromoteOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<StaffUser | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<StaffUser | null>(null);

  const roleParam = toRoleParam(filters.role);
  const statusParam = toStatusParam(filters.status);
  const invitationStatusParam = toInvitationStatusParam(filters.invitation_status);
  const sortField = state.sorting ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;
  const designationsQuery = useDesignations();
  const usersQuery = useUsers({
    page: state.page,
    limit: state.limit,
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(roleParam !== undefined ? { role: roleParam } : {}),
    ...(statusParam !== undefined ? { status: statusParam } : {}),
    ...(invitationStatusParam !== undefined ? { invitation_status: invitationStatusParam } : {}),
    ...(filters.designation_id !== undefined ? { designation_id: filters.designation_id } : {}),
    ...(filters.joined_from !== undefined ? { joined_from: filters.joined_from } : {}),
    ...(filters.joined_to !== undefined ? { joined_to: filters.joined_to } : {}),
    ...(sortField !== undefined ? { sort: sortField } : {}),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  });

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('list.searchLabel'),
      placeholder: t('list.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'role',
      label: t('list.roleFilterLabel'),
      allLabel: t('list.roleFilterAll'),
      options: STAFF_ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('list.statusFilterLabel'),
      allLabel: t('list.statusFilterAll'),
      options: Object.values(UserStatus).map((status) => ({
        value: status,
        label: t(statusLabelKey('user', status), { ns: 'common' }),
      })),
    },
    {
      kind: 'select',
      key: 'invitation_status',
      label: t('list.invitationFilterLabel'),
      allLabel: t('list.invitationFilterAll'),
      options: INVITATION_STATUS_VALUES.map((status) => ({
        value: status,
        label: t(statusLabelKey('invitation', status), { ns: 'common' }),
      })),
    },
    {
      kind: 'select',
      key: 'designation_id',
      label: t('list.designationFilterLabel'),
      allLabel: t('list.designationFilterAll'),
      options: (designationsQuery.data ?? []).map((designation) => ({
        value: designation.id,
        label: designationTitle(designation, locale),
      })),
    },
    {
      kind: 'date-range',
      fromKey: 'joined_from',
      toKey: 'joined_to',
      label: t('list.joinedRangeLabel'),
      fromLabel: t('list.joinedFromLabel'),
      toLabel: t('list.joinedToLabel'),
    },
  ];

  const columns: DataTableColumn<StaffUser>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => (
        <>
          <span className="font-medium">{row.full_name}</span>
          {row.email && <span className="block text-caption text-text-secondary">{row.email}</span>}
        </>
      ),
      sortable: true,
      // [8.14.10] Row's own name (with its email underneath) is the card title.
      card: 'title',
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
      accessorFn: (row) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge domain="user" status={row.status} />
          {row.invitation_status !== 'ACTIVATED' && (
            <StatusBadge domain="invitation" status={row.invitation_status} />
          )}
        </div>
      ),
      sortable: true,
      card: 'badge',
    },
    {
      id: 'joined',
      header: t('list.columnJoined'),
      accessorFn: (row) => formatDate(new Date(row.created_at), regionConfig),
      sortable: true,
    },
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={[
          {
            id: 'promote',
            label: t('list.promoteTeacher'),
            icon: <UserRoundCheckIcon />,
            priority: 'secondary',
            allowed: canCreate,
            onClick: () => setPromoteOpen(true),
          },
          {
            id: 'add',
            label: t('list.addUser'),
            icon: <PlusIcon />,
            priority: 'primary',
            allowed: canCreate,
            onClick: () => setAddUserOpen(true),
          },
        ]}
        filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
        tableId="staff-list"
        caption={t('list.caption')}
        columns={columns}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('list.view'),
            to: `/staff/${row.id}`,
            'data-focus-anchor': row.id,
          },
          {
            intent: 'edit',
            label: t('list.edit'),
            allowed: canUpdate,
            onClick: () => setEditTarget(row),
          },
          {
            intent: 'remove',
            label: t('detail.actions.remove'),
            allowed: canRemove,
            onClick: () => setRemoveTarget(row),
          },
        ]}
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
        {...(canPrint
          ? {
              selectedIds: state.selectedIds,
              onSelectedIdsChange: actions.setSelectedIds,
              bulkActions: (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void navigate({
                        to: '/print/preview',
                        search: {
                          kind: 'STAFF_ID_CARD',
                          subject_type: 'STAFF',
                          ids: Array.from(state.selectedIds).join(','),
                          from: '/staff',
                        },
                      })
                    }
                  >
                    <IdCardIcon aria-hidden="true" />
                    {t('list.printIdCards', { count: state.selectedIds.size })}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => actions.setSelectedIds(new Set())}
                  >
                    <XIcon aria-hidden="true" />
                    {t('list.clearSelection')}
                  </Button>
                </>
              ),
            }
          : {})}
        loading={usersQuery.isLoading}
        isFetching={usersQuery.isFetching}
        {...(usersQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={{
          title: t('list.emptyMessage'),
          explanation: t('list.emptyExplanation'),
          ...(canCreate
            ? { action: { label: t('list.addUser'), onClick: () => setAddUserOpen(true) } }
            : {}),
        }}
        announceResults={(count, total) => t('list.announceResults', { count, total })}
      />

      <AddUserDialog open={addUserOpen} onOpenChange={setAddUserOpen} />
      <PromoteTeacherDialog open={promoteOpen} onOpenChange={setPromoteOpen} />
      {editTarget !== null && (
        <EditUserDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          user={editTarget}
        />
      )}
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
