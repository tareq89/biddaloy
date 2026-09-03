/**
 * [8.11.5]'s standalone Fee Structures list — the page where an
 * administrator defines what each class owes and when, so [8.11.6]'s
 * monthly generation produces the right amounts.
 *
 * Filters (academic year, class, month) map straight onto
 * `GET /fee-structures`'s own query params, so the URL is the single
 * source of truth for what the table shows — same shape as
 * `students/index.tsx`.
 */
import { FeeType, Permission } from '@biddaloy/shared';
import {
  Button,
  CachedDataNotice,
  RoutePending,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  feeStructuresQueryOptions,
  useAcademicYears,
  useClasses,
  useClassSections,
  useFeeStructures,
  useHasPermission,
  type FeeStructure,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { DeleteStructureDialog } from './-delete-structure-dialog';
import { StructureFormDialog } from './-structure-form-dialog';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

interface FeeStructureFilters {
  search?: string | undefined;
  academic_year_id?: string | undefined;
  class_id?: string | undefined;
  section_id?: string | undefined;
  month?: string | undefined;
  fee_type?: string | undefined;
  is_recurring?: string | undefined;
}

const feeStructuresSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  academic_year_id: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  fee_type: z.string().optional().catch(undefined),
  is_recurring: z.string().optional().catch(undefined),
  // Validated as a real 1–12 month rather than a free string: `toListFilters`
  // does `Number(month)`, so `?month=abc` would otherwise reach the API as
  // `month=NaN` and come back a 400, showing the error state instead of
  // degrading to "all months" the way `page`/`limit` already do.
  month: z
    .string()
    .regex(/^(?:[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under — it
  // must be declared here or TanStack Router's `validateSearch` strips it
  // from the URL on every navigation. This page wires no bulk actions
  // today; the key is kept so its search schema matches the other lists'.
  selected: z.string().optional().catch(undefined),
});

function toListFilters(filters: FeeStructureFilters) {
  return {
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.academic_year_id !== undefined
      ? { academic_year_id: filters.academic_year_id }
      : {}),
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    ...(filters.month !== undefined ? { month: Number(filters.month) } : {}),
    ...(filters.fee_type !== undefined ? { fee_type: filters.fee_type as FeeType } : {}),
    ...(filters.is_recurring !== undefined
      ? { is_recurring: filters.is_recurring === 'true' }
      : {}),
  };
}

/** `DataTableSort.id` values that map onto a server-sortable field —
 * `useFeeStructures`'s filter type now accepts `sort`/`order`
 * ([8.14.9]'s server work), keyed by this page's column ids. [8.14.10]:
 * `sorting={null}`/no-op `onSortingChange` used to be a deliberate stub
 * because no such param existed — correction 9 flags it as one of four
 * pages where that's now stale and needs wiring up for real. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, 'name' | 'amount' | 'month' | 'created_at'>> = {
  name: 'name',
  amount: 'amount',
  month: 'month',
};

export const Route = createFileRoute('/_staff/fee-structures/')({
  validateSearch: feeStructuresSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sort: search.sort,
    order: search.order,
    search: search.search,
    academicYearId: search.academic_year_id,
    classId: search.class_id,
    sectionId: search.section_id,
    month: search.month,
    feeType: search.fee_type,
    isRecurring: search.is_recurring,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const sortField = deps.sort !== undefined ? SORT_FIELD_BY_COLUMN[deps.sort] : undefined;
    return Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          feeStructuresQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...toListFilters({
              search: deps.search,
              academic_year_id: deps.academicYearId,
              class_id: deps.classId,
              section_id: deps.sectionId,
              month: deps.month,
              fee_type: deps.feeType,
              is_recurring: deps.isRecurring,
            }),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('feeStructures'),
    ]);
  },
  pendingComponent: FeeStructuresListPending,
  component: FeeStructuresListPage,
});

function FeeStructuresListPage() {
  const { t } = useTranslation('feeStructures');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as FeeStructureFilters;

  const canCreate = useHasPermission(Permission.FEE_STRUCTURE_CREATE);
  const canUpdate = useHasPermission(Permission.FEE_STRUCTURE_UPDATE);
  const canDelete = useHasPermission(Permission.FEE_STRUCTURE_DELETE);

  const sortField = state.sorting !== null ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;

  // [8.12.3]: shared between the query and `CachedDataNotice`'s key —
  // see `students/index.tsx` for why the object is lifted.
  const structureListFilters = {
    page: state.page,
    limit: state.limit,
    ...toListFilters(filters),
    ...(sortField !== undefined ? { sort: sortField } : {}),
    ...(state.sorting ? { order: state.sorting.desc ? ('desc' as const) : ('asc' as const) } : {}),
  };
  const structuresQuery = useFeeStructures(structureListFilters);
  const yearsQuery = useAcademicYears();
  const classesQuery = useClasses(
    filters.academic_year_id !== undefined ? { academic_year_id: filters.academic_year_id } : {},
  );
  const sectionsQuery = useClassSections(filters.class_id);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FeeStructure | null>(null);
  const [deleting, setDeleting] = React.useState<FeeStructure | null>(null);

  // [8.14.10] FilterBar's `onChange` hands back a patch (string sets,
  // `null` clears) rather than the old hand-rolled `setFilter`'s
  // rebuild-the-whole-bag shape. `academic_year_id` still needs its
  // `class_id`-invalidation side effect — same reasoning
  // `students/index.tsx` applies to class → section. `class_id` gets the
  // matching `section_id`-invalidation side effect for the same reason
  // (a section only makes sense for the class it belongs to).
  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('academic_year_id' in next) next.class_id = null;
    if ('class_id' in next) next.section_id = null;
    actions.setFilters(next);
  }

  function monthLabel(month: number) {
    return t(`months.${month}`);
  }

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
      key: 'academic_year_id',
      label: t('list.academicYearLabel'),
      allLabel: t('list.allAcademicYears'),
      options: (yearsQuery.data?.data ?? []).map((year) => ({ value: year.id, label: year.name })),
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
      // Empty until a class is chosen — same reasoning `fees/dues.tsx`
      // documents for its own `section_id` descriptor.
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'fee_type',
      label: t('list.feeTypeLabel'),
      allLabel: t('list.allFeeTypes'),
      options: Object.values(FeeType).map((feeType) => ({
        value: feeType,
        label: t(`feeTypes.${feeType}`),
      })),
    },
    {
      kind: 'checkbox',
      key: 'is_recurring',
      label: t('list.recurringOnlyLabel'),
    },
    {
      kind: 'select',
      key: 'month',
      label: t('list.monthLabel'),
      allLabel: t('list.allMonths'),
      options: MONTHS.map((month) => ({ value: String(month), label: monthLabel(month) })),
    },
  ];

  const columns: DataTableColumn<FeeStructure>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.name,
      sortable: true,
      // [8.14.10] structure name is the natural card title.
      card: 'title',
    },
    {
      id: 'feeType',
      header: t('list.columnType'),
      accessorFn: (row) => t(`feeTypes.${row.fee_type}`),
    },
    {
      id: 'amount',
      header: t('list.columnAmount'),
      // `amount` arrives as a `decimal(10,2)` **string**, which is exactly
      // what `formatServerAmount` exists to take — never `parseFloat`.
      accessorFn: (row) => formatServerAmount(row.amount, regionConfig),
      sortable: true,
      // Money column — right-aligns and carries `tabular-nums` via `align`
      // (design contract §2), per [8.14.7]'s `DataTableColumn.align`.
      align: 'end',
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) =>
        row.section ? `${row.class.name} · ${row.section.section_name}` : row.class.name,
      card: 'subtitle',
    },
    {
      id: 'month',
      header: t('list.columnMonth'),
      // For a recurring structure `month` is an effective-*from* marker
      // (generation applies to every month ≥ it), so the cell says so
      // rather than implying a single month.
      accessorFn: (row) =>
        row.is_recurring
          ? t('list.fromMonth', { month: monthLabel(row.month) })
          : monthLabel(row.month),
      sortable: true,
    },
    {
      id: 'recurrence',
      header: t('list.columnRecurrence'),
      accessorFn: (row) => (
        <StatusBadge domain="feeStructure" status={row.is_recurring ? 'RECURRING' : 'ONE_TIME'} />
      ),
      card: 'badge',
    },
    {
      id: 'applicability',
      header: t('list.columnApplicability'),
      // `GET /fee-structures` deliberately omits `selected_students` (only
      // the detail endpoint loads it), so the exact count is only shown
      // when the server happened to supply it — otherwise the generic
      // label, never a fabricated number.
      accessorFn: (row) => {
        // Compared as a string literal, not `FeeApplicability.SELECTED`:
        // the generated client type is a string union, not the shared
        // enum, so an enum comparison here is unsound.
        if (row.applicability !== 'SELECTED') return t('list.wholeClass');
        const selectedCount = row.selected_students?.length;
        return selectedCount === undefined
          ? t('list.selectedStudentsGeneric')
          : t('list.selectedStudents', { count: selectedCount });
      },
    },
    ...(canUpdate || canDelete
      ? [
          {
            id: 'actions',
            header: t('list.columnActions'),
            pinned: true,
            card: 'actions',
            accessorFn: (row: FeeStructure) => (
              <div className="flex gap-3">
                {canUpdate && (
                  <button
                    type="button"
                    onClick={() => setEditing(row)}
                    className="text-sm font-medium text-primary underline"
                  >
                    {t('list.edit')}
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    className="text-sm font-medium text-destructive underline"
                  >
                    {t('list.delete')}
                  </button>
                )}
              </div>
            ),
          } as DataTableColumn<FeeStructure>,
        ]
      : []),
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <CachedDataNotice queryKey={feeStructuresQueryOptions(structureListFilters).queryKey} />
      <ListShell
        title={t('list.title')}
        primaryAction={
          canCreate && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('list.addStructure')}
            </Button>
          )
        }
        filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
        tableId="fee-structures-list"
        caption={t('list.caption')}
        columns={columns}
        data={structuresQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={structuresQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={structuresQuery.isLoading}
        isFetching={structuresQuery.isFetching}
        {...(structuresQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
      />

      {canCreate && (
        <StructureFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {canUpdate && editing && (
        <StructureFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          structure={editing}
          onSaved={() => setEditing(null)}
        />
      )}

      {canDelete && deleting && (
        <DeleteStructureDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          feeStructureId={deleting.id}
          feeStructureName={deleting.name}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </RegionConfigProvider>
  );
}

function FeeStructuresListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
