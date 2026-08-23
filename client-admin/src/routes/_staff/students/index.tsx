import { EnrollmentStatus, Permission } from '@biddaloy/shared';
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
  studentQueryOptions,
  studentsQueryOptions,
  useClasses,
  useClassSections,
  useHasPermission,
  useStudents,
  type Student,
  type StudentSortField,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { SendReminderDialog } from './-send-reminder-dialog';

/** Radix `Select.Item` rejects an empty-string `value` (it's reserved to
 * mean "clear the selection" internally), so "All classes"/"All
 * sections"/"All statuses" need a real sentinel value instead — chosen on
 * `class_id`/`section_id`/`enrollment_status` never being this string. */
const ALL_VALUE = '__all__';

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
  }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.ensureQueryData(
      studentsQueryOptions({
        page: deps.page,
        limit: deps.limit,
        ...toStudentListFilters(
          {
            search: deps.search,
            class_id: deps.classId,
            section_id: deps.sectionId,
            enrollment_status: deps.enrollmentStatus,
          },
          deps.sort,
        ),
        ...(deps.order !== undefined ? { order: deps.order } : {}),
      }),
    ),
  component: StudentsListPage,
});

function StudentsListPage() {
  const { t } = useTranslation('students');
  const queryClient = useQueryClient();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as StudentFilters;

  // Local, un-debounced echo of the search box — typing updates this on
  // every keystroke so the input never feels laggy, while the URL (and
  // thus the outgoing request) only follows 300ms after the last
  // keystroke. Reset whenever the URL's own value changes from outside
  // this input (the "Clear filter"-style case: a `<Link>` elsewhere
  // rewriting `search` directly), so the two never drift apart.
  const [searchInput, setSearchInput] = React.useState(filters.search ?? '');
  React.useEffect(() => {
    setSearchInput(filters.search ?? '');
  }, [filters.search]);

  // The timeout below only keys off `searchInput`, so its closure would
  // otherwise capture whichever `filters`/`actions` existed at the render
  // that scheduled it — stale if another filter (e.g. class_id) changes
  // during the 300ms window, silently reverting that change when the
  // timeout fires. Refs updated every render keep the callback reading
  // current values instead.
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

  const studentsQuery = useStudents({
    page: state.page,
    limit: state.limit,
    ...toStudentListFilters(filters, state.sorting?.id),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  });
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);

  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canAddStudent = useHasPermission(Permission.STUDENT_CREATE);

  const [reminderDialogOpen, setReminderDialogOpen] = React.useState(false);

  function setFilter(key: keyof StudentFilters, value: string | undefined) {
    const next = { ...filters, [key]: value };
    if (value === undefined) delete next[key];
    // Changing `class_id` invalidates whatever `section_id` was chosen
    // for the *previous* class — a stale section filter would silently
    // scope results to a section that doesn't belong to the newly
    // selected class.
    if (key === 'class_id') delete next.section_id;
    actions.setFilters(next as Record<string, string>);
  }

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
    const lines = rows.map((student) =>
      [
        student.roll_number,
        student.registration_number,
        student.full_name,
        student.class_section.class.name,
        student.class_section.section_name,
        primaryGuardianName(student),
        student.enrollment_status,
      ]
        .map((value) => csvCell(value))
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\r\n');
    // Excel on Windows decodes a BOM-less CSV using the system code page,
    // mangling non-Latin header text (e.g. the bn locale) — prepend the
    // UTF-8 BOM so it reads the file as UTF-8 instead.
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'students.csv';
    anchor.click();
    URL.revokeObjectURL(url);
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
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => row.class_section.class.name,
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

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canAddStudent && (
            <Button asChild>
              <Link to="/students/new">{t('list.addStudent')}</Link>
            </Button>
          )
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
              value={filters.class_id ?? ALL_VALUE}
              onValueChange={(value) =>
                setFilter('class_id', value === ALL_VALUE ? undefined : value)
              }
            >
              <SelectTrigger aria-label={t('list.classLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('list.allClasses')}</SelectItem>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.section_id ?? ALL_VALUE}
              onValueChange={(value) =>
                setFilter('section_id', value === ALL_VALUE ? undefined : value)
              }
              disabled={filters.class_id === undefined}
            >
              <SelectTrigger aria-label={t('list.sectionLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('list.allSections')}</SelectItem>
                {sectionsQuery.data?.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.section_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.enrollment_status ?? ALL_VALUE}
              onValueChange={(value) =>
                setFilter('enrollment_status', value === ALL_VALUE ? undefined : value)
              }
            >
              <SelectTrigger aria-label={t('list.statusLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('list.allStatuses')}</SelectItem>
                {Object.values(EnrollmentStatus).map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
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
        selectedIds={state.selectedIds}
        onSelectedIdsChange={actions.setSelectedIds}
        columnsMenu
        columnsMenuLabel={t('list.columnsButton')}
        defaultColumnVisibility={{
          dateOfBirth: false,
          gender: false,
          address: false,
          preferredCommunication: false,
        }}
        loading={studentsQuery.isLoading}
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
    </>
  );
}

function primaryGuardianName(student: Student): string | undefined {
  return (student.guardians.find((g) => g.is_primary_contact) ?? student.guardians[0])?.full_name;
}

// A value starting with `=`, `+`, `-`, `@`, or a tab/CR is a formula to
// spreadsheet software (Excel, Sheets) — a guardian name like
// `=HYPERLINK(...)` would execute on open. Prefixing with `'` forces it
// to render as text instead, same as Excel's own CSV-injection guidance.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  let text = String(value);
  if (CSV_FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
