import { Permission } from '@biddaloy/shared';
import { RoutePending, Skeleton, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  useAcademicYearStats,
  useAcademicYears,
  useCreateAcademicYear,
  useHasPermission,
  useUpdateAcademicYear,
  type AcademicYear,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDateRange, formatNumber, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CalendarRangeIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { useLandingFlag } from '../-use-landing-flag';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { DeleteYearDialog } from './-delete-year-dialog';
import { YearFormDialog, type YearFormPayload } from './-year-form-dialog';

// ponytail: one page of 100 years, add paging if a tenant ever has more
const YEARS_LIMIT = 100;

// `z.looseObject`, not `z.object`: a plain object would strip the list-state params.
export const Route = createFileRoute('/_staff/academic-years/')({
  validateSearch: z.looseObject({ new: z.coerce.string().optional().catch(undefined) }),
  // [8.14.5]: no search-string filters here (unlike `students/index.tsx`),
  // so no `loaderDeps` — the list's full first page is the same query on
  // every visit.
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: swallowed for the same reason `audit-logs/index.tsx`'s
      // loader does — a rejection here would hand the route to the
      // router's generic error boundary before `useAcademicYears` gets a
      // chance to run the same query and surface its own error UI.
      queryClient
        .ensureQueryData(academicYearsQueryOptions({ limit: YEARS_LIMIT }))
        .catch(swallowUnlessOffline),
      // 'backup' feeds the [14.13.2] migrate-a-whole-school link below the
      // (empty) list.
      loadRouteNamespaces('academicYears', 'backup'),
    ]),
  pendingComponent: AcademicYearsListPending,
  component: AcademicYearsListPage,
});

/** `AcademicYearStats` is fetched per row (`GET /academic-years/:id/stats`,
 * [8.11.1]) — a tenant's whole year list is always a handful of rows
 * (`classes.ts`'s own `CLASS_FILTER_LIMIT` precedent), so N tiny requests
 * beats a bespoke list-with-counts endpoint. */
function StatCell({
  academicYearId,
  field,
}: {
  academicYearId: string;
  field: 'classes_count' | 'students_count';
}) {
  const stats = useAcademicYearStats(academicYearId);
  const regionConfig = useRegionConfig();
  const { t } = useTranslation('academicYears');
  if (stats.isPending) return <Skeleton className="ms-auto h-3 w-6" />;
  const value = stats.data?.[field];
  if (stats.isError || value === undefined) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('detail.statsUnavailable')}</span>
      </>
    );
  }
  return <>{formatNumber(value, regionConfig)}</>;
}

function AcademicYearsListPage() {
  const { t } = useTranslation('academicYears');
  const { t: tBackup } = useTranslation('backup');
  // `useRegionConfig()` has no ambient provider above the route tree —
  // see `$academicYearId.tsx`'s identical wrap for why this is needed.
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: YEARS_LIMIT });
  const canManage = useHasPermission(Permission.ACADEMIC_YEAR_MANAGE);
  const canManageBackup = useHasPermission(Permission.BACKUP_MANAGE);

  const yearsQuery = useAcademicYears({ limit: YEARS_LIMIT });
  const isEmpty =
    !yearsQuery.isLoading && !yearsQuery.isError && (yearsQuery.data?.total ?? 0) === 0;

  const createYear = useCreateAcademicYear();
  const [createOpen, setCreateOpen] = useLandingFlag('new', canManage);

  const [editing, setEditing] = React.useState<AcademicYear | null>(null);
  const updateYear = useUpdateAcademicYear(editing?.id ?? '');

  const [deleting, setDeleting] = React.useState<AcademicYear | null>(null);

  function openCreate() {
    createYear.reset();
    setCreateOpen(true);
  }

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
      card: 'title',
      accessorFn: (row) => (
        <Link
          to="/academic-years/$academicYearId"
          params={{ academicYearId: row.id }}
          className="font-medium text-text-primary hover:text-primary"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'period',
      header: t('list.columnPeriod'),
      card: 'subtitle',
      accessorFn: (row) => formatDateRange(row.start_date, row.end_date, regionConfig),
    },
    {
      id: 'is_current',
      header: t('list.columnCurrent'),
      card: 'badge',
      accessorFn: (row) => (
        <StatusBadge domain="academicYear" status={row.is_current ? 'CURRENT' : 'NOT_CURRENT'} />
      ),
    },
    {
      id: 'classes_count',
      header: t('list.columnClasses'),
      align: 'end',
      card: 'field',
      accessorFn: (row) => <StatCell academicYearId={row.id} field="classes_count" />,
    },
    {
      id: 'students_count',
      header: t('list.columnStudents'),
      align: 'end',
      card: 'field',
      accessorFn: (row) => <StatCell academicYearId={row.id} field="students_count" />,
    },
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={[
          {
            id: 'add',
            label: t('list.addYear'),
            icon: <PlusIcon />,
            priority: 'primary',
            allowed: canManage,
            onClick: openCreate,
          },
        ]}
        tableId="academic-years-list"
        caption={t('list.caption')}
        columns={columns}
        rowActions={(row) => [
          { intent: 'view', label: t('list.view'), to: `/academic-years/${row.id}` },
          {
            intent: 'edit',
            label: t('list.edit'),
            allowed: canManage,
            onClick: () => {
              updateYear.reset();
              setEditing(row);
            },
          },
          {
            intent: 'delete',
            label: t('list.delete'),
            allowed: canManage,
            onClick: () => setDeleting(row),
          },
        ]}
        data={yearsQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        paginated={false}
        totalCount={yearsQuery.data?.total ?? 0}
        loading={yearsQuery.isLoading}
        isFetching={yearsQuery.isFetching}
        {...(yearsQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={{
          icon: <CalendarRangeIcon />,
          title: t('list.emptyMessage'),
          explanation: t('list.emptyExplanation'),
          ...(canManage ? { action: { label: t('list.emptyAction'), onClick: openCreate } } : {}),
        }}
      />

      {/* [14.13.2]: same migrate-a-whole-school entry point as the
          students/classes lists, offered where a newcomer with an empty
          academic-years list is already looking. */}
      {isEmpty && canManageBackup && (
        <p className="text-text-secondary">
          {tBackup('migrateWholeSchool')}{' '}
          <Link to="/settings" className="font-medium text-primary underline underline-offset-2">
            {tBackup('migrateWholeSchoolLink')}
          </Link>
        </p>
      )}

      {/* Dialogs mount only while open, so each open starts with fresh state. */}
      {canManage && createOpen && (
        <YearFormDialog
          open
          onOpenChange={setCreateOpen}
          mode="create"
          isPending={createYear.isPending}
          isError={createYear.isError}
          onSubmit={handleCreate}
        />
      )}

      {canManage && editing && (
        <YearFormDialog
          open
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
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          academicYearId={deleting.id}
          academicYearName={deleting.name}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </RegionConfigProvider>
  );
}

function AcademicYearsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
