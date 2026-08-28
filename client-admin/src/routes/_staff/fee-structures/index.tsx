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
import { Permission } from '@biddaloy/shared';
import {
  Button,
  CachedDataNotice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  feeStructuresQueryOptions,
  useAcademicYears,
  useClasses,
  useFeeStructures,
  useHasPermission,
  type FeeStructure,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { DeleteStructureDialog } from './-delete-structure-dialog';
import { StructureFormDialog } from './-structure-form-dialog';

/** Radix `Select.Item` rejects an empty-string `value` (it reserves it for
 * "clear selection"), so the "All …" options need a real sentinel —
 * same one `students/index.tsx` uses, for the same reason. */
const ALL_VALUE = '__all__';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

interface FeeStructureFilters {
  academic_year_id?: string | undefined;
  class_id?: string | undefined;
  month?: string | undefined;
}

const feeStructuresSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  academic_year_id: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
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
    ...(filters.academic_year_id !== undefined
      ? { academic_year_id: filters.academic_year_id }
      : {}),
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.month !== undefined ? { month: Number(filters.month) } : {}),
  };
}

export const Route = createFileRoute('/_staff/fee-structures/')({
  validateSearch: feeStructuresSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    academicYearId: search.academic_year_id,
    classId: search.class_id,
    month: search.month,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.ensureQueryData(
      feeStructuresQueryOptions({
        page: deps.page,
        limit: deps.limit,
        ...toListFilters({
          academic_year_id: deps.academicYearId,
          class_id: deps.classId,
          month: deps.month,
        }),
      }),
    ),
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

  // [8.12.3]: shared between the query and `CachedDataNotice`'s key —
  // see `students/index.tsx` for why the object is lifted.
  const structureListFilters = {
    page: state.page,
    limit: state.limit,
    ...toListFilters(filters),
  };
  const structuresQuery = useFeeStructures(structureListFilters);
  const yearsQuery = useAcademicYears();
  const classesQuery = useClasses(
    filters.academic_year_id !== undefined ? { academic_year_id: filters.academic_year_id } : {},
  );

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FeeStructure | null>(null);
  const [deleting, setDeleting] = React.useState<FeeStructure | null>(null);

  function setFilter(key: keyof FeeStructureFilters, value: string | undefined) {
    // `null`, not a deleted key, is what clears a param — an absent key
    // leaves the old value in the URL (see `ListUrlStatePatch`), which is
    // what made "All years/classes/months" a no-op.
    const next: Record<string, string | null> = {
      academic_year_id: filters.academic_year_id ?? null,
      class_id: filters.class_id ?? null,
      month: filters.month ?? null,
      [key]: value ?? null,
    };
    // A class belongs to exactly one academic year, so whichever class was
    // picked under the *previous* year can't survive the switch — same
    // reasoning `students/index.tsx` applies to class → section.
    if (key === 'academic_year_id') next.class_id = null;
    actions.setFilters(next);
  }

  function monthLabel(month: number) {
    return t(`months.${month}`);
  }

  const columns: DataTableColumn<FeeStructure>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.name,
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
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) =>
        row.section ? `${row.class.name} · ${row.section.section_name}` : row.class.name,
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
    },
    {
      id: 'recurrence',
      header: t('list.columnRecurrence'),
      accessorFn: (row) => (
        <StatusBadge domain="feeStructure" status={row.is_recurring ? 'RECURRING' : 'ONE_TIME'} />
      ),
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
        filterBar={
          <>
            <Select
              value={filters.academic_year_id ?? ALL_VALUE}
              onValueChange={(value) =>
                setFilter('academic_year_id', value === ALL_VALUE ? undefined : value)
              }
            >
              <SelectTrigger aria-label={t('list.academicYearLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('list.allAcademicYears')}</SelectItem>
                {yearsQuery.data?.data.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              value={filters.month ?? ALL_VALUE}
              onValueChange={(value) => setFilter('month', value === ALL_VALUE ? undefined : value)}
            >
              <SelectTrigger aria-label={t('list.monthLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('list.allMonths')}</SelectItem>
                {MONTHS.map((month) => (
                  <SelectItem key={month} value={String(month)}>
                    {monthLabel(month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        tableId="fee-structures-list"
        caption={t('list.caption')}
        columns={columns}
        data={structuresQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {
          // No sortable columns — `QueryFeeStructureDto` accepts no
          // `sort`/`order` param, so there's nothing to sort server-side.
        }}
        page={state.page}
        pageSize={state.limit}
        totalCount={structuresQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        loading={structuresQuery.isLoading}
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
