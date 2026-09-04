/**
 * Classes list — [8.11.2]. Rows expand inline (via `DataTable`'s
 * `renderExpandedRow`, [8.11.2]'s own addition to that component) to
 * reveal a class's sections, with create/edit/delete happening in place
 * rather than a separate page — the issue's own acceptance criteria.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  CachedDataNotice,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  classesQueryOptions,
  useAcademicYears,
  useClasses,
  useHasPermission,
  type ClassWithCounts,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ClassFormDialog } from './-class-form-dialog';
import { DeleteClassDialog } from './-delete-class-dialog';
import { SectionsPanel } from './-sections-panel';

export const Route = createFileRoute('/_staff/classes/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient.ensureQueryData(classesQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('classes'),
    ]),
  pendingComponent: ClassesListPending,
  component: ClassesListPage,
});

/** Radix `Select.Item` rejects an empty-string `value` — same sentinel
 * convention `students/index.tsx`/`dues.tsx` use for "All classes"/"All
 * sections". */
const ALL_VALUE = '__all__';

interface ClassFilters {
  academic_year_id?: string | undefined;
}

function ClassesListPage() {
  const { t } = useTranslation('classes');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as ClassFilters;
  const canManage = useHasPermission(Permission.CLASS_MANAGE);

  const academicYearsQuery = useAcademicYears();

  // Derived at render time, not written to the URL by an effect — an
  // effect that back-fills "current year" into the URL the first time
  // `academicYearsQuery` resolves would fire *after* the initial,
  // unfiltered `useClasses` request already went out, forcing a second
  // request (and, worse, briefly unmounting/remounting the data rows in
  // between, since `DataTable` swaps to its loading placeholder for that
  // gap — losing whatever row a user had mid-interaction with, like an
  // expanded section panel). Three states, not two, live in the URL's
  // `academic_year_id`: absent (not chosen yet — defaults to the current
  // year below), `ALL_VALUE` (explicitly "All academic years" — a real,
  // sticky choice, not just "absent"), or a real id.
  const currentYearId = academicYearsQuery.data?.data.find((year) => year.is_current)?.id;
  const effectiveAcademicYearId =
    filters.academic_year_id === undefined
      ? currentYearId
      : filters.academic_year_id === ALL_VALUE
        ? undefined
        : filters.academic_year_id;

  // [8.12.3]: shared between the query and `CachedDataNotice`'s key —
  // see `students/index.tsx` for why the object is lifted.
  const classListFilters = {
    ...(effectiveAcademicYearId !== undefined ? { academic_year_id: effectiveAcademicYearId } : {}),
    page: state.page,
    limit: state.limit,
  };
  const classesQuery = useClasses(classListFilters);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ClassWithCounts | null>(null);
  const [deleting, setDeleting] = React.useState<ClassWithCounts | null>(null);

  const columns: DataTableColumn<ClassWithCounts>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => (
        <Link
          to="/classes/$classId"
          params={{ classId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'grade',
      header: t('list.columnGrade'),
      accessorFn: (row) => row.numeric_grade ?? t('list.noGrade'),
    },
    {
      id: 'sections',
      header: t('list.columnSections'),
      // Server-computed (`ClassService.findAll`'s `section_count`), not
      // `row.sections.length` — this endpoint no longer loads the
      // `sections` relation at all.
      accessorFn: (row) => formatNumber(row.section_count, regionConfig),
      align: 'end',
    },
    {
      id: 'students',
      header: t('list.columnStudents'),
      // Server-computed (`ClassService.findAll`'s `student_count`), not a
      // per-row `useClassSections(classId)` mount summing
      // `enrolled_count` client-side — that was 10 concurrent
      // `GET /classes/:id/sections` requests on a full page.
      accessorFn: (row) => formatNumber(row.student_count, regionConfig),
      align: 'end',
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('list.columnActions'),
            pinned: true,
            accessorFn: (row: ClassWithCounts) => (
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="text-sm font-medium text-primary underline"
                >
                  {t('list.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(row)}
                  className="text-sm font-medium text-destructive underline"
                >
                  {t('list.delete')}
                </button>
              </div>
            ),
          } satisfies DataTableColumn<ClassWithCounts>,
        ]
      : []),
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <CachedDataNotice queryKey={classesQueryOptions(classListFilters).queryKey} />
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('list.addClass')}
            </Button>
          )
        }
        filterBar={
          <Select
            value={effectiveAcademicYearId ?? ALL_VALUE}
            onValueChange={(value) =>
              // Writes `ALL_VALUE` itself when chosen, not an absent key —
              // see the `effectiveAcademicYearId` comment above on why
              // "explicitly All" has to be a distinct, sticky URL state
              // from "not chosen yet".
              actions.setFilters({ ...state.filters, academic_year_id: value })
            }
          >
            <SelectTrigger aria-label={t('list.academicYearLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('list.allAcademicYears')}</SelectItem>
              {academicYearsQuery.data?.data.map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {year.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        tableId="classes-list"
        caption={t('list.caption')}
        columns={columns}
        data={classesQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={classesQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={classesQuery.isLoading}
        isFetching={classesQuery.isFetching}
        {...(classesQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
        expandRowLabel={(row) => t('list.expandLabel', { name: row.name })}
        renderExpandedRow={(row) => <SectionsPanel classId={row.id} className={row.name} />}
      />

      {canManage && (
        <ClassFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          {...(effectiveAcademicYearId !== undefined
            ? { defaultAcademicYearId: effectiveAcademicYearId }
            : {})}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {canManage && editing && (
        <ClassFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          classId={editing.id}
          initialValues={{ name: editing.name, numericGrade: editing.numeric_grade ?? undefined }}
          onSaved={() => setEditing(null)}
        />
      )}

      {canManage && deleting && (
        <DeleteClassDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          classId={deleting.id}
          className={deleting.name}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </RegionConfigProvider>
  );
}

function ClassesListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
