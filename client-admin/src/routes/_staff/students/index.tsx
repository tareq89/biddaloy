import { EnrollmentStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  CachedDataNotice,
  RoutePending,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  studentQueryOptions,
  studentsQueryOptions,
  useClasses,
  useClassSections,
  useHasPermission,
  useStudents,
  type Student,
  type StudentListFilters,
  type StudentSortField,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { downloadCsv } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SendReminderDialog } from './-send-reminder-dialog';

/** `DataTableSort.id` values that map onto a server-sortable field —
 * `StudentSortField`'s own allowlist, keyed by this page's column ids
 * rather than the server's column names, since a column's `id` (what
 * `DataTable` reports back through `onSortingChange`) is this page's own
 * naming, not the API's. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, StudentSortField>> = {
  registration: 'registration_number',
  name: 'full_name',
};

/** `useListShellState`'s generic `filters` bag round-trips through the
 * URL as `Record<string, string>` — this narrows the handful of keys this
 * page actually reads/writes, same shape as `StudentListFilters` minus
 * `page`/`limit`/`sort`/`order` (those are `ListShellState`'s own,
 * separately-typed fields). */
interface StudentFilters {
  search?: string | undefined;
  class_id?: string | undefined;
  section_id?: string | undefined;
  enrollment_status?: string | undefined;
  gender?: string | undefined;
  date_of_birth_from?: string | undefined;
  date_of_birth_to?: string | undefined;
}

const studentsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  enrollment_status: z.string().optional().catch(undefined),
  gender: z.string().optional().catch(undefined),
  date_of_birth_from: z.string().optional().catch(undefined),
  date_of_birth_to: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores the row selection
  // under (comma-joined ids) — must be declared here or TanStack
  // Router's `validateSearch` strips it from the URL on every navigation,
  // since a plain `z.object` drops any key it doesn't know about.
  selected: z.string().optional().catch(undefined),
});

function toStudentListFilters(filters: StudentFilters, sortColumnId: string | undefined) {
  const sortField = sortColumnId ? SORT_FIELD_BY_COLUMN[sortColumnId] : undefined;
  return {
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    ...(filters.enrollment_status !== undefined
      ? { enrollment_status: filters.enrollment_status }
      : {}),
    ...(filters.gender !== undefined ? { gender: filters.gender } : {}),
    ...(filters.date_of_birth_from !== undefined
      ? { date_of_birth_from: filters.date_of_birth_from }
      : {}),
    ...(filters.date_of_birth_to !== undefined
      ? { date_of_birth_to: filters.date_of_birth_to }
      : {}),
    ...(sortField !== undefined ? { sort: sortField } : {}),
  };
}

export const Route = createFileRoute('/_staff/students/')({
  validateSearch: studentsSearchSchema,
  // Without `loaderDeps`, the loader only reruns when the route's own
  // path params change — every filter/sort/page value here lives in the
  // search string instead, so they all have to be listed explicitly for
  // a filter change to actually trigger a refetch.
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sort: search.sort,
    order: search.order,
    search: search.search,
    classId: search.class_id,
    sectionId: search.section_id,
    enrollmentStatus: search.enrollment_status,
    gender: search.gender,
    dateOfBirthFrom: search.date_of_birth_from,
    dateOfBirthTo: search.date_of_birth_to,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          studentsQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...toStudentListFilters(
              {
                search: deps.search,
                class_id: deps.classId,
                section_id: deps.sectionId,
                enrollment_status: deps.enrollmentStatus,
                gender: deps.gender,
                date_of_birth_from: deps.dateOfBirthFrom,
                date_of_birth_to: deps.dateOfBirthTo,
              },
              deps.sort,
            ),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('students'),
    ]),
  pendingComponent: StudentsListPending,
  component: StudentsListPage,
});

function StudentsListPage() {
  const { t } = useTranslation('students');
  const queryClient = useQueryClient();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as StudentFilters;

  // [8.12.3]: the filter bag is lifted into a variable so the exact same
  // object feeds the query *and* `CachedDataNotice`'s key. Rebuilding the
  // key by hand at the render site is how the notice silently stops
  // matching the query it is supposed to be describing.
  // Annotated, not inferred: spreading a conditional `order` into a
  // fresh object widens it to `string`, which `StudentListFilters` (an
  // `'asc' | 'desc'` union) rightly rejects.
  const studentListFilters: StudentListFilters = {
    page: state.page,
    limit: state.limit,
    ...toStudentListFilters(filters, state.sorting?.id),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  };
  const studentsQuery = useStudents(studentListFilters);
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);

  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canAddStudent = useHasPermission(Permission.STUDENT_CREATE);
  const canBulkImport = useHasPermission(Permission.STUDENT_BULK_UPLOAD);

  const [reminderDialogOpen, setReminderDialogOpen] = React.useState(false);

  // FilterBar's `onChange` patches one key at a time — intercept `class_id`
  // changes to also clear `section_id`, since a section chosen under the
  // *previous* class would otherwise silently over-scope results to a
  // section that doesn't belong to the newly selected class.
  function handleFiltersChange(patch: Record<string, string | null>) {
    actions.setFilters('class_id' in patch ? { ...patch, section_id: null } : patch);
  }

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
      key: 'class_id',
      label: t('list.classLabel'),
      allLabel: t('list.allClasses'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('list.sectionLabel'),
      allLabel: t('list.allSections'),
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'enrollment_status',
      label: t('list.statusLabel'),
      allLabel: t('list.allStatuses'),
      options: Object.values(EnrollmentStatus).map((status) => ({ value: status, label: status })),
    },
    {
      kind: 'text',
      key: 'gender',
      label: t('list.genderFilterLabel'),
      placeholder: t('list.genderFilterLabel'),
    },
    {
      kind: 'date-range',
      fromKey: 'date_of_birth_from',
      toKey: 'date_of_birth_to',
      label: t('list.dateOfBirthRangeLabel'),
      fromLabel: t('list.dateOfBirthFromLabel'),
      toLabel: t('list.dateOfBirthToLabel'),
    },
  ];

  async function exportSelectedToCsv() {
    // `selectedIds` persists across pages, but `studentsQuery.data` only
    // holds the current page — resolve every selected student by id so a
    // selection made on an earlier page isn't silently dropped from the
    // export. `ensureQueryData` reuses the cache for rows already fetched
    // (e.g. via the current page or a visited detail page).
    const rows = await Promise.all(
      Array.from(state.selectedIds).map((id) =>
        queryClient.ensureQueryData(studentQueryOptions(id)),
      ),
    );
    const header = ['Roll', 'Registration No.', 'Name', 'Class', 'Section', 'Guardian', 'Status'];
    const lines = rows.map((student) => [
      student.roll_number,
      student.registration_number,
      student.full_name,
      student.class_section.class.name,
      student.class_section.section_name,
      primaryGuardianName(student),
      student.enrollment_status,
    ]);
    downloadCsv('students.csv', [header, ...lines]);
  }

  const columns: DataTableColumn<Student>[] = [
    {
      id: 'roll',
      header: t('list.columnRoll'),
      accessorFn: (row) => row.roll_number,
    },
    {
      id: 'registration',
      header: t('list.columnRegistration'),
      accessorFn: (row) => row.registration_number,
      sortable: true,
    },
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
      sortable: true,
      // [8.14.7] The row's own name is the natural card title.
      card: 'title',
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => row.class_section.class.name,
      // [8.14.7] Class alone (not class + section) is the closest thing
      // this row has to a subtitle — short enough to sit under the name
      // without repeating what `section` already spells out in the `dl`.
      card: 'subtitle',
    },
    {
      id: 'section',
      header: t('list.columnSection'),
      accessorFn: (row) => row.class_section.section_name,
    },
    {
      id: 'guardian',
      header: t('list.columnGuardian'),
      accessorFn: (row) => primaryGuardianName(row) ?? t('list.noGuardian'),
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge domain="enrollment" status={row.enrollment_status as EnrollmentStatus} />
      ),
      // [8.14.7] Same "value + badge on the end side" grammar as
      // `portal/fees.tsx`'s invoice rows.
      card: 'badge',
    },
    {
      id: 'dateOfBirth',
      header: t('list.columnDateOfBirth'),
      accessorFn: (row) => row.date_of_birth ?? t('list.emptyValue'),
    },
    {
      id: 'gender',
      header: t('list.columnGender'),
      accessorFn: (row) => row.gender ?? t('list.emptyValue'),
    },
    {
      id: 'address',
      header: t('list.columnAddress'),
      accessorFn: (row) => row.home_address ?? t('list.emptyValue'),
    },
    {
      id: 'preferredCommunication',
      header: t('list.columnPreferredCommunication'),
      accessorFn: (row) => row.preferred_communication,
    },
    {
      id: 'actions',
      header: t('list.columnActions'),
      pinned: true,
      // Already `pinned: true`, which `DataTable`'s default card-role
      // resolution would assign to `'actions'` on its own — declared
      // explicitly anyway so this stays correct if a future column also
      // becomes `pinned`.
      card: 'actions',
      accessorFn: (row) => (
        <div className="flex justify-end gap-3">
          {canCollectFees && (
            <Link
              to="/payments/record"
              search={{ student_id: row.id }}
              className="text-sm font-medium text-primary underline"
            >
              {t('list.collectFees')}
            </Link>
          )}
          <Link
            to="/students/$studentId"
            params={{ studentId: row.id }}
            data-focus-anchor={row.id}
            className="text-sm text-muted-foreground underline"
          >
            {t('list.view')}
          </Link>
        </div>
      ),
    },
  ];

  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <CachedDataNotice queryKey={studentsQueryOptions(studentListFilters).queryKey} />
      <ListShell
        title={t('list.title')}
        primaryAction={
          <div className="flex items-center gap-2">
            {canBulkImport && (
              <Button asChild variant="outline">
                <Link to="/students/import">{t('list.importStudents')}</Link>
              </Button>
            )}
            {canAddStudent && (
              <Button asChild>
                <Link to="/students/new">{t('list.addStudent')}</Link>
              </Button>
            )}
          </div>
        }
        filters={{ fields: filterFields, values: state.filters, onChange: handleFiltersChange }}
        tableId="students-list"
        caption={t('list.caption')}
        columns={columns}
        data={studentsQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={studentsQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        selectedIds={state.selectedIds}
        onSelectedIdsChange={actions.setSelectedIds}
        columnsMenu
        columnsMenuLabel={t('list.columnsButton')}
        sortMenuLabel={t('list.sortMenuLabel')}
        sortOptionLabel={(header, direction) =>
          direction === 'asc'
            ? t('list.sortOptionLabelAscending', { header })
            : direction === 'desc'
              ? t('list.sortOptionLabelDescending', { header })
              : header
        }
        defaultColumnVisibility={{
          dateOfBirth: false,
          gender: false,
          address: false,
          preferredCommunication: false,
        }}
        loading={studentsQuery.isLoading}
        isFetching={studentsQuery.isFetching}
        {...(studentsQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
        bulkActions={
          <>
            {canSendReminder && (
              <Button type="button" size="sm" onClick={() => setReminderDialogOpen(true)}>
                {t('list.sendReminder')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void exportSelectedToCsv()}
            >
              {t('list.exportCsv')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => actions.setSelectedIds(new Set())}
            >
              {t('list.clearSelection')}
            </Button>
          </>
        }
      />
      <SendReminderDialog
        open={reminderDialogOpen}
        onOpenChange={setReminderDialogOpen}
        studentIds={Array.from(state.selectedIds)}
        onSent={() => actions.setSelectedIds(new Set())}
      />
    </RegionConfigProvider>
  );
}

function primaryGuardianName(student: Student): string | undefined {
  return (student.guardians.find((g) => g.is_primary_contact) ?? student.guardians[0])?.full_name;
}

function StudentsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
