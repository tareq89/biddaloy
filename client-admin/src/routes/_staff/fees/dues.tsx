import { FeeStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  RoutePending,
  StatusBadge,
  humanizeStatus,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  feeDuesKeys,
  feeDuesQueryOptions,
  useClasses,
  useClassSections,
  useFeeDues,
  useHasPermission,
  useLastReminders,
  type FeeDueRow,
  type FeeDuesSortBy,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { downloadCsv, formatDate, formatServerAmount } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';
import { SendReminderDialog } from '../students/-send-reminder-dialog';

import { GenerateInvoiceDialog } from './-generate-invoice-dialog';

/** `DataTableSort.id` values that map onto a server-sortable field —
 * `QueryFeeDuesDto.sort_by`'s own allowlist, keyed by this page's column
 * ids. Only sortable when `flagged` is off — `QueryFlaggedDuesDto` has no
 * sort fields at all; the service fixes months-overdue-desc server-side. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, FeeDuesSortBy>> = {
  student: 'name',
  class: 'class',
  due: 'due_amount',
};

interface DuesFilters {
  class_id?: string | undefined;
  section_id?: string | undefined;
  month?: string | undefined;
  year?: string | undefined;
  status?: string | undefined;
  flagged?: string | undefined;
}

const duesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  month: z.string().optional().catch(undefined),
  year: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  flagged: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores the row selection under
  // — must be declared here or TanStack Router's `validateSearch` strips
  // it from the URL on every navigation.
  selected: z.string().optional().catch(undefined),
});

function toFeeDuesFilters(
  filters: DuesFilters,
  sortColumnId: string | undefined,
  flagged: boolean,
) {
  // The flagged endpoint accepts no sort fields (see the QueryFeeDuesDto
  // note above) — never send sort_by/sort_order alongside flagged=true.
  const sortField = !flagged && sortColumnId ? SORT_FIELD_BY_COLUMN[sortColumnId] : undefined;
  return {
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    ...(filters.month !== undefined ? { month: Number(filters.month) } : {}),
    ...(filters.year !== undefined ? { year: Number(filters.year) } : {}),
    ...(filters.status !== undefined
      ? { status: filters.status as FeeStatus.PENDING | FeeStatus.PARTIALLY_PAID }
      : {}),
    ...(sortField !== undefined ? { sort_by: sortField } : {}),
  };
}

export const Route = createFileRoute('/_staff/fees/dues')({
  validateSearch: duesSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sort: search.sort,
    order: search.order,
    classId: search.class_id,
    sectionId: search.section_id,
    month: search.month,
    year: search.year,
    status: search.status,
    flagged: search.flagged === 'true',
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          feeDuesQueryOptions(
            {
              page: deps.page,
              limit: deps.limit,
              ...toFeeDuesFilters(
                {
                  class_id: deps.classId,
                  section_id: deps.sectionId,
                  month: deps.month,
                  year: deps.year,
                  status: deps.status,
                },
                deps.sort,
                deps.flagged,
              ),
              ...(deps.order !== undefined && !deps.flagged
                ? { sort_order: deps.order === 'desc' ? 'DESC' : 'ASC' }
                : {}),
            },
            deps.flagged,
          ),
        )
        .catch(() => undefined),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: DuesQueuePending,
  component: DuesQueuePage,
});

/** `months_overdue > 0` (the flagged endpoint's own definition of
 * "overdue") wins over the per-fee-month status mix, since it's the
 * stronger signal — a partially-paid fee that's also overdue is
 * overdue, not merely partial. No single status field exists on the
 * aggregate itself (`StudentDueAggregate` has none), so this derives
 * one from what the row already carries. */
function deriveRowStatus(row: FeeDueRow): FeeStatus {
  if (row.months_overdue > 0) return FeeStatus.OVERDUE;
  return row.dues.some((due) => due.status === FeeStatus.PARTIALLY_PAID)
    ? FeeStatus.PARTIALLY_PAID
    : FeeStatus.PENDING;
}

function DuesQueuePage() {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const queryClient = useQueryClient();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as DuesFilters;
  const flagged = filters.flagged === 'true';

  const duesQuery = useFeeDues(
    {
      page: state.page,
      limit: state.limit,
      ...toFeeDuesFilters(filters, state.sorting?.id, flagged),
      ...(state.sorting && !flagged ? { sort_order: state.sorting.desc ? 'DESC' : 'ASC' } : {}),
    },
    flagged,
  );
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);

  const rows = React.useMemo(() => duesQuery.data?.data ?? [], [duesQuery.data]);

  // Bulk actions (Generate Invoice, Export) need each selected row's full
  // dues breakdown, not just its id — and `selectedIds` persists across
  // pages while `duesQuery.data` only holds the current one. There's no
  // `GET /fees/dues/:studentId` to re-fetch a row by id (unlike
  // `students/index.tsx`'s CSV export, which resolves stale selections
  // via `studentQueryOptions`), so this accumulates every row this
  // session has actually loaded into view instead — a selection made on
  // an earlier page during this visit is still resolvable; one from a
  // stale bookmark/reload is not, and drops silently from those two
  // actions (Send Reminder is unaffected — it only needs student ids).
  const rowCacheRef = React.useRef(new Map<string, FeeDueRow>());
  React.useEffect(() => {
    for (const row of rows) rowCacheRef.current.set(row.student_id, row);
  }, [rows]);

  const selectedRows = Array.from(state.selectedIds)
    .map((id) => rowCacheRef.current.get(id))
    .filter((row): row is FeeDueRow => row !== undefined);

  const visibleStudentIds = React.useMemo(() => rows.map((row) => row.student_id), [rows]);
  const lastRemindersQuery = useLastReminders(visibleStudentIds);
  const lastReminders = lastRemindersQuery.data;

  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canGenerateInvoice = useHasPermission(Permission.INVOICE_CREATE);

  const [reminderDialogOpen, setReminderDialogOpen] = React.useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = React.useState(false);

  // Plain zero-padded numbers, not localized month names — no shared
  // month-name formatter exists in `@biddaloy/ui/utils`/`i18n` yet
  // (`formatDate`'s own doc comment: numeric-only "deliberately not a
  // localized month-name format... a locale-aware calendar UI composes
  // this with real i18n later"), and `boundary/no-raw-intl` forbids
  // reaching for `Intl.DateTimeFormat` directly outside that shared
  // layer. Same digit rendering `fees-tab.tsx` already uses for a
  // fee-month label (`{fee.year}-{String(fee.month).padStart(2, '0')}`).
  const monthOptions = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')),
    [],
  );
  const currentYear = new Date().getFullYear();
  const yearOptions = React.useMemo(
    () => [currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(String),
    [currentYear],
  );

  // [8.14.10] FilterBar's `onChange` hands back a patch (string sets,
  // `null` clears) rather than the old hand-rolled `setFilter`'s
  // rebuild-the-whole-bag shape. `class_id` still needs its
  // `section_id`-invalidation side effect — same reasoning
  // `students/index.tsx` documents for its own class/section pair — so
  // that one key gets special-cased on top of the generic patch.
  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('class_id' in next) next.section_id = null;
    actions.setFilters(next);
  }

  function toReminderLabel(studentId: string): string {
    const reminder = lastReminders?.get(studentId);
    return reminder
      ? formatDate(new Date(reminder.sent_at), regionConfig)
      : t('dues.neverReminded');
  }

  function exportSelectedToCsv() {
    const header = [
      t('dues.columnStudent'),
      t('dues.columnClass'),
      t('dues.columnSection'),
      t('dues.columnTotal'),
      t('dues.columnPaid'),
      t('dues.columnDue'),
      t('dues.columnStatus'),
      t('dues.columnLastReminder'),
    ];
    const lines = selectedRows.map((row) => {
      const totalBilled = row.dues.reduce((sum, due) => sum + due.total_amount, 0);
      const paid = row.dues.reduce((sum, due) => sum + due.paid_amount, 0);
      return [
        row.full_name,
        row.class_name ?? '',
        row.section_name ?? '',
        formatServerAmount(totalBilled, regionConfig),
        formatServerAmount(paid, regionConfig),
        formatServerAmount(row.total_due, regionConfig),
        humanizeStatus(deriveRowStatus(row)),
        toReminderLabel(row.student_id),
      ];
    });
    downloadCsv('dues.csv', [header, ...lines]);
  }

  const columns: DataTableColumn<FeeDueRow>[] = [
    {
      id: 'student',
      header: t('dues.columnStudent'),
      accessorFn: (row) => `${row.full_name} (${row.registration_number})`,
      sortable: !flagged,
      // [8.14.10] name is the natural card title.
      card: 'title',
    },
    {
      id: 'class',
      header: t('dues.columnClass'),
      accessorFn: (row) => row.class_name ?? t('dues.allClasses'),
      sortable: !flagged,
      card: 'subtitle',
    },
    {
      id: 'section',
      header: t('dues.columnSection'),
      accessorFn: (row) => row.section_name ?? t('dues.allSections'),
    },
    {
      id: 'total',
      header: t('dues.columnTotal'),
      // `row.total_due` is already `total_amount - paid_amount -
      // discount_amount` summed server-side (`FeeDuesService`'s own
      // `StudentDueAggregate.total_due` doc comment) — the *balance*, not
      // the gross billed amount. Gross total is billed + paid, recomputed
      // from the per-month breakdown for this column specifically.
      accessorFn: (row) =>
        formatServerAmount(
          row.dues.reduce((sum, due) => sum + due.total_amount, 0),
          regionConfig,
        ),
      // Money column — right-aligns and carries `tabular-nums` via
      // `align` (design contract §2), per [8.14.7]'s `DataTableColumn.align`.
      align: 'end',
    },
    {
      id: 'paid',
      header: t('dues.columnPaid'),
      accessorFn: (row) =>
        formatServerAmount(
          row.dues.reduce((sum, due) => sum + due.paid_amount, 0),
          regionConfig,
        ),
      align: 'end',
    },
    {
      id: 'due',
      header: t('dues.columnDue'),
      accessorFn: (row) => formatServerAmount(row.total_due, regionConfig),
      sortable: !flagged,
      align: 'end',
    },
    {
      id: 'status',
      header: t('dues.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="fee" status={deriveRowStatus(row)} />,
      card: 'badge',
    },
    {
      id: 'lastReminder',
      header: t('dues.columnLastReminder'),
      accessorFn: (row) => toReminderLabel(row.student_id),
    },
    {
      id: 'actions',
      header: t('dues.columnActions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) =>
        canCollectFees && (
          <Link
            to="/payments/record"
            search={{ student_id: row.student_id }}
            className="text-sm font-medium text-primary underline"
          >
            {t('dues.collect')}
          </Link>
        ),
    },
  ];

  // [8.14.10] `section_id`/`month`/`year`/`status` used the `disabled`
  // prop to grey out while their governing choice (class chosen /
  // not flagged) made them meaningless — `FilterBar`'s `SelectFilterField`
  // has no `disabled` prop (`ui/src/shells/filter-bar.tsx`), and this
  // migration doesn't touch that file. The equivalent here is an empty
  // `options` array: the control still renders, but there is nothing to
  // pick beyond "All …", so it can't drive a meaningless filter. This
  // preserves the *functional* coupling (no stray month/year/status filter
  // while `class_id`/`flagged` disagree) without the greyed-out visual —
  // flagged in the PR body as a design-system gap, not fixed here.
  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'class_id',
      label: t('dues.classLabel'),
      allLabel: t('dues.allClasses'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('dues.sectionLabel'),
      allLabel: t('dues.allSections'),
      // Empty until a class is chosen — `useClassSections` itself only
      // fetches once `class_id` is set, so `sectionsQuery.data` is
      // naturally `undefined` until then.
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'month',
      label: t('dues.monthLabel'),
      allLabel: t('dues.allMonths'),
      options: flagged
        ? []
        : monthOptions.map((month, index) => ({ value: String(index + 1), label: month })),
    },
    {
      kind: 'select',
      key: 'year',
      label: t('dues.yearLabel'),
      allLabel: t('dues.allYears'),
      options: flagged ? [] : yearOptions.map((year) => ({ value: year, label: year })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('dues.statusLabel'),
      allLabel: t('dues.allStatuses'),
      options: flagged
        ? []
        : [
            { value: FeeStatus.PENDING, label: humanizeStatus(FeeStatus.PENDING) },
            { value: FeeStatus.PARTIALLY_PAID, label: humanizeStatus(FeeStatus.PARTIALLY_PAID) },
          ],
    },
    {
      kind: 'checkbox',
      key: 'flagged',
      label: t('dues.flaggedToggleLabel'),
    },
  ];

  return (
    <>
      <ListShell
        title={t('dues.title')}
        filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
        tableId="fees-dues"
        caption={t('dues.caption')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.student_id}
        sorting={flagged ? null : state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={duesQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        selectedIds={state.selectedIds}
        onSelectedIdsChange={actions.setSelectedIds}
        columnsMenu
        columnsMenuLabel={t('dues.columnsButton')}
        loading={duesQuery.isLoading}
        isFetching={duesQuery.isFetching}
        {...(duesQuery.isError ? { error: t('dues.errorMessage') } : {})}
        emptyMessage={t('dues.emptyMessage')}
        announceResults={(count, total) =>
          t('dues.announceResults', { visible: count, total, count: total })
        }
        bulkActions={
          <>
            {canSendReminder && (
              <Button type="button" size="sm" onClick={() => setReminderDialogOpen(true)}>
                {t('dues.sendReminder')}
              </Button>
            )}
            {canGenerateInvoice && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setInvoiceDialogOpen(true)}
              >
                {t('dues.generateInvoice')}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={exportSelectedToCsv}>
              {t('dues.exportCsv')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => actions.setSelectedIds(new Set())}
            >
              {t('dues.clearSelection')}
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
      <GenerateInvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        rows={selectedRows}
        onGenerated={() => {
          actions.setSelectedIds(new Set());
          void queryClient.invalidateQueries({ queryKey: feeDuesKeys.all });
        }}
        onPartialGenerate={(succeededStudentIds) => {
          const next = new Set(state.selectedIds);
          for (const id of succeededStudentIds) next.delete(id);
          actions.setSelectedIds(next);
          void queryClient.invalidateQueries({ queryKey: feeDuesKeys.all });
        }}
      />
    </>
  );
}

function DuesQueuePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
