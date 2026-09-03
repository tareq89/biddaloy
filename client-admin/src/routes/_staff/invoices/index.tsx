import { InvoiceStatus, Permission } from '@biddaloy/shared';
import {
  RoutePending,
  StatusBadge,
  humanizeStatus,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  invoicesQueryOptions,
  openPrintableInvoice,
  useHasPermission,
  useInvoices,
  type Invoice,
  type InvoiceListFilters,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

interface InvoiceFilters {
  search?: string | undefined;
  student_id?: string | undefined;
  status?: string | undefined;
  from_date?: string | undefined;
  to_date?: string | undefined;
  min_amount?: string | undefined;
  max_amount?: string | undefined;
}

const invoicesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  student_id: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  from_date: z.string().optional().catch(undefined),
  to_date: z.string().optional().catch(undefined),
  min_amount: z.string().optional().catch(undefined),
  max_amount: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // must be declared here or TanStack Router's `validateSearch` strips it
  // from the URL, same reasoning as every other list route's search schema.
  selected: z.string().optional().catch(undefined),
});

/** `DataTableSort.id` values that map onto a server-sortable field — see
 * `students/index.tsx`'s identical `SORT_FIELD_BY_COLUMN` comment. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, NonNullable<InvoiceListFilters['sort']>>> = {
  number: 'invoice_number',
  amount: 'total_amount',
  status: 'status',
  issuedDate: 'issued_date',
  dueDate: 'due_date',
};

function toInvoiceListFilters(filters: InvoiceFilters) {
  const minAmount = filters.min_amount !== undefined ? Number(filters.min_amount) : undefined;
  const maxAmount = filters.max_amount !== undefined ? Number(filters.max_amount) : undefined;
  return {
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.student_id !== undefined ? { student_id: filters.student_id } : {}),
    ...(filters.status !== undefined ? { status: filters.status as InvoiceStatus } : {}),
    ...(filters.from_date !== undefined ? { from_date: filters.from_date } : {}),
    ...(filters.to_date !== undefined ? { to_date: filters.to_date } : {}),
    ...(minAmount !== undefined && Number.isFinite(minAmount) ? { min_amount: minAmount } : {}),
    ...(maxAmount !== undefined && Number.isFinite(maxAmount) ? { max_amount: maxAmount } : {}),
  };
}

export const Route = createFileRoute('/_staff/invoices/')({
  validateSearch: invoicesSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    sort: search.sort,
    order: search.order,
    search: search.search,
    studentId: search.student_id,
    status: search.status,
    fromDate: search.from_date,
    toDate: search.to_date,
    minAmount: search.min_amount,
    maxAmount: search.max_amount,
  }),
  loader: ({ context: { queryClient }, deps }) => {
    const sortField = deps.sort !== undefined ? SORT_FIELD_BY_COLUMN[deps.sort] : undefined;
    return Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          invoicesQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...toInvoiceListFilters({
              search: deps.search,
              student_id: deps.studentId,
              status: deps.status,
              from_date: deps.fromDate,
              to_date: deps.toDate,
              min_amount: deps.minAmount,
              max_amount: deps.maxAmount,
            }),
            ...(sortField !== undefined ? { sort: sortField } : {}),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('fees'),
    ]);
  },
  pendingComponent: InvoicesListPending,
  component: InvoicesListPage,
});

function InvoicesListPage() {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  // `student_id` round-trips through this generic `filters` bag same as
  // every other key — reading it from here (not a separate
  // `Route.useSearch()` call) is what keeps the FilterBar chip's "clear"
  // button and the outgoing query in agreement; previously this page read
  // `student_id` via `Route.useSearch()` directly, so clearing the chip
  // emptied the URL while the query still used the stale value.
  const filters = state.filters as InvoiceFilters;
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);

  const sortField = state.sorting ? SORT_FIELD_BY_COLUMN[state.sorting.id] : undefined;
  const invoicesQuery = useInvoices({
    page: state.page,
    limit: state.limit,
    ...toInvoiceListFilters(filters),
    ...(sortField !== undefined ? { sort: sortField } : {}),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  });

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('invoices.searchLabel'),
      placeholder: t('invoices.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'status',
      label: t('invoices.statusLabel'),
      allLabel: t('invoices.allStatuses'),
      options: Object.values(InvoiceStatus).map((status) => ({
        value: status,
        label: humanizeStatus(status),
      })),
    },
    {
      kind: 'date-range',
      fromKey: 'from_date',
      toKey: 'to_date',
      label: t('invoices.dateRangeLabel'),
      fromLabel: t('invoices.fromDateLabel'),
      toLabel: t('invoices.toDateLabel'),
    },
    {
      kind: 'number-range',
      minKey: 'min_amount',
      maxKey: 'max_amount',
      label: t('invoices.amountRangeLabel'),
      minLabel: t('invoices.minAmountLabel'),
      maxLabel: t('invoices.maxAmountLabel'),
    },
  ];

  const columns: DataTableColumn<Invoice>[] = [
    {
      id: 'number',
      header: t('invoices.columnNumber'),
      accessorFn: (row) => (
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.invoice_number}
        </Link>
      ),
      sortable: true,
      // [8.14.10] The invoice number is the natural card title.
      card: 'title',
    },
    {
      id: 'student',
      header: t('invoices.columnStudent'),
      accessorFn: (row) => row.student.full_name,
      card: 'subtitle',
    },
    {
      id: 'amount',
      header: t('invoices.columnAmount'),
      accessorFn: (row) => formatServerAmount(row.total_amount, regionConfig),
      // Money column right-aligns and carries `tabular-nums` via `align`
      // (design contract §2) — no manual `<span className="tabular-nums">`
      // needed any more, per [8.14.7]'s `DataTableColumn.align`.
      align: 'end',
      sortable: true,
    },
    {
      id: 'status',
      header: t('invoices.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="invoice" status={row.status as InvoiceStatus} />,
      sortable: true,
      card: 'badge',
    },
    {
      id: 'issuedDate',
      header: t('invoices.columnIssueDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.issued_date), regionConfig),
      sortable: true,
    },
    {
      id: 'dueDate',
      header: t('invoices.columnDueDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.due_date), regionConfig),
      sortable: true,
    },
    ...(canPrint
      ? [
          {
            id: 'actions',
            header: t('invoices.columnActions'),
            pinned: true,
            card: 'actions',
            accessorFn: (row: Invoice) => (
              <button
                type="button"
                onClick={() =>
                  void openPrintableInvoice(row.id, () => toast.error(t('invoices.printError')))
                }
                className="text-sm font-medium text-primary underline"
              >
                {t('invoices.print')}
              </button>
            ),
          } satisfies DataTableColumn<Invoice>,
        ]
      : []),
  ];

  return (
    <ListShell
      title={t('invoices.title')}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      tableId="invoices-list"
      caption={t('invoices.caption')}
      columns={columns}
      data={invoicesQuery.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={invoicesQuery.data?.total ?? 0}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={invoicesQuery.isLoading}
      isFetching={invoicesQuery.isFetching}
      {...(invoicesQuery.isError ? { error: t('invoices.errorMessage') } : {})}
      emptyMessage={t('invoices.emptyMessage')}
      announceResults={(count, total) =>
        t('invoices.announceResults', { visible: count, total, count: total })
      }
    />
  );
}

function InvoicesListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
