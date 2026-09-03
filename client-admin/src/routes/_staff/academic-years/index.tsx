import { Permission } from '@biddaloy/shared';
import { Button, RoutePending, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  useAcademicYearStats,
  useAcademicYears,
  useCreateAcademicYear,
  useHasPermission,
  useUpdateAcademicYear,
  type AcademicYear,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatAcademicYear, formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { DeleteYearDialog } from './-delete-year-dialog';
import { SetCurrentDialog } from './-set-current-dialog';
import { YearFormDialog, type YearFormPayload } from './-year-form-dialog';

export const Route = createFileRoute('/_staff/academic-years/')({
  // [8.14.5]: no search-string filters here (unlike `students/index.tsx`),
  // so no `loaderDeps` — the list's full first page is the same query on
  // every visit.
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: swallowed for the same reason `audit-logs/index.tsx`'s
      // loader does — a rejection here would hand the route to the
      // router's generic error boundary before `useAcademicYears` gets a
      // chance to run the same query and surface its own error UI.
      queryClient.ensureQueryData(academicYearsQueryOptions()).catch(() => undefined),
      loadRouteNamespaces('academicYears'),
    ]),
  pendingComponent: AcademicYearsListPending,
  component: AcademicYearsListPage,
});

/** `AcademicYearStats` is fetched per row (`GET /academic-years/:id/stats`,
 * [8.11.1]) — a tenant's whole year list is always a handful of rows
 * (`classes.ts`'s own `CLASS_FILTER_LIMIT` precedent), so N tiny requests
 * beats a bespoke list-with-counts endpoint. */
function ClassesCountCell({ academicYearId }: { academicYearId: string }) {
  const stats = useAcademicYearStats(academicYearId);
  return <>{stats.data?.classes_count ?? '—'}</>;
}

function StudentsCountCell({ academicYearId }: { academicYearId: string }) {
  const stats = useAcademicYearStats(academicYearId);
  return <>{stats.data?.students_count ?? '—'}</>;
}

function AcademicYearsListPage() {
  const { t } = useTranslation('academicYears');
  // `useRegionConfig()` has no ambient provider above the route tree —
  // see `$academicYearId.tsx`'s identical wrap for why this is needed.
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const canManage = useHasPermission(Permission.ACADEMIC_YEAR_MANAGE);

  const yearsQuery = useAcademicYears({ page: state.page, limit: state.limit });

  const createYear = useCreateAcademicYear();
  const [createOpen, setCreateOpen] = React.useState(false);

  const [editing, setEditing] = React.useState<AcademicYear | null>(null);
  const updateYear = useUpdateAcademicYear(editing?.id ?? '');

  const [deleting, setDeleting] = React.useState<AcademicYear | null>(null);
  const [settingCurrent, setSettingCurrent] = React.useState<AcademicYear | null>(null);

  function handleCreate(payload: YearFormPayload) {
    createYear.mutate(payload, { onSuccess: () => setCreateOpen(false) });
  }

  function handleUpdate(payload: YearFormPayload) {
    updateYear.mutate(payload, { onSuccess: () => setEditing(null) });
  }

  const columns: DataTableColumn<AcademicYear>[] = [
    {
      id: 'name',
      header: t('list.columnYear'),
      accessorFn: (row) => (
        <Link
          to="/academic-years/$academicYearId"
          params={{ academicYearId: row.id }}
          className="font-medium text-primary underline"
        >
          {formatAcademicYear(parseServerDate(row.start_date), regionConfig)}
        </Link>
      ),
    },
    {
      id: 'start_date',
      header: t('list.columnStartDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.start_date), regionConfig),
    },
    {
      id: 'end_date',
      header: t('list.columnEndDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.end_date), regionConfig),
    },
    {
      id: 'is_current',
      header: t('list.columnCurrent'),
      accessorFn: (row) => (
        <StatusBadge domain="academicYear" status={row.is_current ? 'CURRENT' : 'NOT_CURRENT'} />
      ),
    },
    {
      id: 'classes_count',
      header: t('list.columnClasses'),
      accessorFn: (row) => <ClassesCountCell academicYearId={row.id} />,
    },
    {
      id: 'students_count',
      header: t('list.columnStudents'),
      accessorFn: (row) => <StudentsCountCell academicYearId={row.id} />,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('list.columnActions'),
            pinned: true,
            accessorFn: (row: AcademicYear) => (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="text-sm font-medium text-primary underline"
                >
                  {t('list.edit')}
                </button>
                {!row.is_current && (
                  <button
                    type="button"
                    onClick={() => setSettingCurrent(row)}
                    className="text-sm font-medium text-primary underline"
                  >
                    {t('list.setCurrent')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleting(row)}
                  className="text-sm font-medium text-destructive underline"
                >
                  {t('list.delete')}
                </button>
              </div>
            ),
          } satisfies DataTableColumn<AcademicYear>,
        ]
      : []),
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('list.addYear')}
            </Button>
          )
        }
        tableId="academic-years-list"
        caption={t('list.caption')}
        columns={columns}
        data={yearsQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={yearsQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={yearsQuery.isLoading}
        isFetching={yearsQuery.isFetching}
        {...(yearsQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
      />

      {canManage && (
        <YearFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          isPending={createYear.isPending}
          isError={createYear.isError}
          onSubmit={handleCreate}
        />
      )}

      {canManage && editing && (
        <YearFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          initialValues={{
            name: editing.name,
            startDate: parseServerDate(editing.start_date),
            endDate: parseServerDate(editing.end_date),
            isCurrent: editing.is_current,
          }}
          isPending={updateYear.isPending}
          isError={updateYear.isError}
          onSubmit={handleUpdate}
        />
      )}

      {canManage && deleting && (
        <DeleteYearDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          academicYearId={deleting.id}
          academicYearName={deleting.name}
          onDeleted={() => setDeleting(null)}
        />
      )}

      {canManage && settingCurrent && (
        <SetCurrentDialog
          open={settingCurrent !== null}
          onOpenChange={(open) => !open && setSettingCurrent(null)}
          academicYearId={settingCurrent.id}
          academicYearName={settingCurrent.name}
          onConfirmed={() => setSettingCurrent(null)}
        />
      )}
    </RegionConfigProvider>
  );
}

function AcademicYearsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
