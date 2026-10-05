/**
 * Classes list — [8.11.2], restyled [31.4 classes-1]: kit `FilterBar`,
 * `DataTable` with icon `rowActions`, 25 per page. Sections are managed on
 * the class detail page (the view action), not inline.
 */
import { Permission } from '@biddaloy/shared';
import {
  CachedDataNotice,
  RoutePending,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  classesQueryOptions,
  useAcademicYears,
  useClasses,
  useHasPermission,
  useOrganisationVocabulary,
  type ClassWithCounts,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PlusIcon, SchoolIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ClassFormDialog } from './-class-form-dialog';
import { DeleteClassDialog } from './-delete-class-dialog';

export const Route = createFileRoute('/_staff/classes/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient.ensureQueryData(classesQueryOptions({})).catch(swallowUnlessOffline),
      // 'backup' feeds the [14.13.2] migrate-a-whole-school link below the
      // (empty) list.
      loadRouteNamespaces('classes', 'backup'),
    ]),
  pendingComponent: ClassesListPending,
  component: ClassesListPage,
});

/** Radix `Select.Item` rejects an empty-string `value` — same sentinel
 * convention `students/index.tsx`/`dues.tsx` use for "All classes"/"All
 * sections". Also used below for the shift/version filters, not just
 * `academic_year_id` — a real academic year id is a UUID (no collision
 * risk), but shift/version are free-text organisation vocabulary an
 * admin can name anything up to 50 characters.
 *
 * [CodeRabbit, PR #916] Leading space, not a plain `'__all__'` — the
 * vocabulary validator (`UniqueLabelListConstraint`) rejects any entry
 * where `entry.trim() !== entry`, so this sentinel is structurally
 * impossible for a real shift/version name to equal. Don't "clean up"
 * this leading space; it's load-bearing. */
const ALL_VALUE = ' __all__';

interface ClassFilters {
  academic_year_id?: string | undefined;
  shift?: string | undefined;
  version?: string | undefined;
}

function ClassesListPage() {
  const { t } = useTranslation('classes');
  const { t: tBackup } = useTranslation('backup');
  const regionConfig = useTenantRegionConfig();
  const navigate = useNavigate();
  const [state, actions] = useListShellState();
  const filters = state.filters as ClassFilters;
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const canManageBackup = useHasPermission(Permission.BACKUP_MANAGE);

  const academicYearsQuery = useAcademicYears();
  const vocabularyQuery = useOrganisationVocabulary();
  // [D5] Filter chips only exist once the tenant has 2+ entries — a
  // single-shift school has nothing to filter on, so no chip renders.
  const shifts = vocabularyQuery.data?.shifts ?? [];
  const versions = vocabularyQuery.data?.versions ?? [];
  const showShiftFilter = shifts.length >= 2;
  const showVersionFilter = versions.length >= 2;

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
    ...(showShiftFilter && filters.shift !== undefined ? { shift: filters.shift } : {}),
    ...(showVersionFilter && filters.version !== undefined ? { version: filters.version } : {}),
    page: state.page,
    limit: state.limit,
  };
  const classesQuery = useClasses(classListFilters);
  const isEmpty =
    !classesQuery.isLoading && !classesQuery.isError && (classesQuery.data?.total ?? 0) === 0;

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ClassWithCounts | null>(null);
  const [deleting, setDeleting] = React.useState<ClassWithCounts | null>(null);

  const currentYear = academicYearsQuery.data?.data.find((year) => year.is_current);
  // What the FilterBar shows: the default (current) year is "absent" so it
  // gets no chip; hidden shift/version filters are dropped like in the request.
  const filterValues: Record<string, string> = {
    ...(filters.academic_year_id !== undefined && filters.academic_year_id !== currentYearId
      ? { academic_year_id: filters.academic_year_id }
      : {}),
    ...(showShiftFilter && filters.shift ? { shift: filters.shift } : {}),
    ...(showVersionFilter && filters.version ? { version: filters.version } : {}),
  };

  const rowActions = (row: ClassWithCounts): RowAction[] => [
    { intent: 'view', label: t('list.view'), to: `/classes/${row.id}` },
    { intent: 'edit', label: t('list.edit'), onClick: () => setEditing(row), allowed: canManage },
    {
      intent: 'delete',
      label: t('list.delete'),
      onClick: () => setDeleting(row),
      allowed: canManage,
    },
  ];

  const columns: DataTableColumn<ClassWithCounts>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => (
        <Link
          to="/classes/$classId"
          params={{ classId: row.id }}
          className="font-medium text-text-primary hover:text-primary"
        >
          {row.name}
          {(row.shift || row.version) && (
            <span className="block text-caption font-normal text-text-secondary">
              {[row.shift, row.version].filter(Boolean).join(' · ')}
            </span>
          )}
        </Link>
      ),
    },
    {
      id: 'grade',
      header: t('list.columnGrade'),
      accessorFn: (row) =>
        row.numeric_grade == null
          ? t('list.noGrade')
          : formatNumber(row.numeric_grade, regionConfig),
      align: 'end',
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
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <CachedDataNotice queryKey={classesQueryOptions(classListFilters).queryKey} />
      <ListShell
        title={t('list.title')}
        actions={[
          {
            id: 'add',
            label: t('list.addClass'),
            icon: <PlusIcon aria-hidden="true" />,
            priority: 'primary',
            allowed: canManage,
            onClick: () => setCreateOpen(true),
          },
        ]}
        filters={{
          fields: [
            {
              kind: 'select',
              key: 'academic_year_id',
              label: t('list.academicYearLabel'),
              // The built-in "no filter" item means "the default (current)
              // year"; without a current year it means all years.
              allLabel: currentYear?.name ?? t('list.allAcademicYears'),
              options: [
                ...(currentYear ? [{ value: ALL_VALUE, label: t('list.allAcademicYears') }] : []),
                ...(academicYearsQuery.data?.data ?? [])
                  .filter((year) => year.id !== currentYearId)
                  .map((year) => ({ value: year.id, label: year.name })),
              ],
            },
            ...(showShiftFilter
              ? [
                  {
                    kind: 'select' as const,
                    key: 'shift',
                    label: t('list.shiftLabel'),
                    allLabel: t('list.allShifts'),
                    options: shifts.map((value) => ({ value, label: value })),
                  },
                ]
              : []),
            ...(showVersionFilter
              ? [
                  {
                    kind: 'select' as const,
                    key: 'version',
                    label: t('list.versionLabel'),
                    allLabel: t('list.allVersions'),
                    options: versions.map((value) => ({ value, label: value })),
                  },
                ]
              : []),
          ],
          values: filterValues,
          onChange: (patch) => {
            const next = { ...patch };
            // Picking the current year is the same as the default (absent).
            if (next.academic_year_id === currentYearId) next.academic_year_id = null;
            actions.setFilters({ ...state.filters, ...next });
          },
          ...(classesQuery.data ? { resultCount: classesQuery.data.total } : {}),
        }}
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
        loading={classesQuery.isLoading}
        isFetching={classesQuery.isFetching}
        {...(classesQuery.isError ? { error: t('list.errorMessage') } : {})}
        rowActions={rowActions}
        emptyState={{
          icon: <SchoolIcon aria-hidden="true" />,
          title: t('list.emptyMessage'),
          explanation: t('list.emptyExplanation'),
          ...(canManage
            ? { action: { label: t('list.addClass'), onClick: () => setCreateOpen(true) } }
            : {}),
          ...(isEmpty && canManageBackup
            ? {
                secondaryAction: {
                  label: tBackup('migrateWholeSchoolLink'),
                  onClick: () => void navigate({ to: '/settings' }),
                },
              }
            : {}),
        }}
        announceResults={(count, total) =>
          t('list.announceResults', {
            visible: formatNumber(count, regionConfig),
            total: formatNumber(total, regionConfig),
            count: total,
          })
        }
      />

      {canManage && createOpen && (
        <ClassFormDialog
          open
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
          open
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          classId={editing.id}
          initialValues={{
            name: editing.name,
            numericGrade: editing.numeric_grade ?? undefined,
            shift: editing.shift ?? null,
            version: editing.version ?? null,
          }}
          onSaved={() => setEditing(null)}
        />
      )}

      {canManage && deleting && (
        <DeleteClassDialog
          open
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
