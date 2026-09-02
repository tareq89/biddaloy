import { InvoiceStatus, Permission } from '@biddaloy/shared';
import {
  DatePicker,
  Input,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatServerAmount,
  parseDate,
  parseServerDate,
  toLatinDigits,
} from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

/** Radix `Select.Item` rejects an empty-string `value` — same sentinel
 * convention `students/index.tsx`/`fees/dues.tsx` use for "All statuses". */
const ALL_VALUE = '__all__';

interface InvoiceFilters {
  search?: string | undefined;
  status?: string | undefined;
  from_date?: string | undefined;
  to_date?: string | undefined;
}

const invoicesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  student_id: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  from_date: z.string().optional().catch(undefined),
  to_date: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores the row selection under
  // — must be declared here or TanStack Router's `validateSearch` strips
  // it from the URL on every navigation. This list has no bulk actions
  // today, but the key still round-trips through `useListShellState`.
  selected: z.string().optional().catch(undefined),
});

function toInvoiceListFilters(filters: InvoiceFilters, studentId: string | undefined) {
  return {
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(studentId !== undefined ? { student_id: studentId } : {}),
    ...(filters.status !== undefined ? { status: filters.status as InvoiceStatus } : {}),
    ...(filters.from_date !== undefined ? { from_date: filters.from_date } : {}),
    ...(filters.to_date !== undefined ? { to_date: filters.to_date } : {}),
  };
}

export const Route = createFileRoute('/_staff/invoices/')({
  validateSearch: invoicesSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    search: search.search,
    studentId: search.student_id,
    status: search.status,
    fromDate: search.from_date,
    toDate: search.to_date,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          invoicesQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...toInvoiceListFilters(
              {
                search: deps.search,
                status: deps.status,
                from_date: deps.fromDate,
                to_date: deps.toDate,
              },
              deps.studentId,
            ),
          }),
        )
        .catch(() => undefined),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: InvoicesListPending,
  component: InvoicesListPage,
});

function InvoicesListPage() {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const search = Route.useSearch();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as InvoiceFilters;
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);

  // Un-debounced local echo of the URL's `search`, same reasoning
  // `students/index.tsx` documents: typing shouldn't push a URL/query
  // update on every keystroke, but a `<Link>` elsewhere rewriting the URL
  // directly should still show up here.
  const [searchInput, setSearchInput] = React.useState(filters.search ?? '');
  React.useEffect(() => {
    setSearchInput(filters.search ?? '');
  }, [filters.search]);

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

  const invoicesQuery = useInvoices({
    page: state.page,
    limit: state.limit,
    ...toInvoiceListFilters(filters, search.student_id),
  });

  function setFilter(key: keyof InvoiceFilters, value: string | undefined) {
    const next = { ...filters, [key]: value };
    if (value === undefined) delete next[key];
    actions.setFilters(next as Record<string, string>);
  }

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
    },
    {
      id: 'student',
      header: t('invoices.columnStudent'),
      accessorFn: (row) => row.student.full_name,
    },
    {
      id: 'amount',
      header: t('invoices.columnAmount'),
      // tabular-nums: money columns align on the decimal (design contract §2).
      // Effective for Latin digits (`en`); a no-op on Bengali numerals, whose
      // face ships no `tnum` — see §2's note.
      accessorFn: (row) => (
        <span className="tabular-nums">{formatServerAmount(row.total_amount, regionConfig)}</span>
      ),
    },
    {
      id: 'status',
      header: t('invoices.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="invoice" status={row.status as InvoiceStatus} />,
    },
    {
      id: 'issuedDate',
      header: t('invoices.columnIssueDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.issued_date), regionConfig),
    },
    {
      id: 'dueDate',
      header: t('invoices.columnDueDate'),
      accessorFn: (row) => formatDate(parseServerDate(row.due_date), regionConfig),
    },
    ...(canPrint
      ? [
          {
            id: 'actions',
            header: t('invoices.columnActions'),
            pinned: true,
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
      filterBar={
        <>
          <Input
            aria-label={t('invoices.searchLabel')}
            placeholder={t('invoices.searchPlaceholder')}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Select
            value={filters.status ?? ALL_VALUE}
            onValueChange={(value) => setFilter('status', value === ALL_VALUE ? undefined : value)}
          >
            <SelectTrigger aria-label={t('invoices.statusLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('invoices.allStatuses')}</SelectItem>
              {Object.values(InvoiceStatus).map((status) => (
                <SelectItem key={status} value={status}>
                  {humanizeStatus(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DatePicker
            aria-label={t('invoices.fromDateLabel')}
            config={regionConfig}
            value={filters.from_date ? parseDate(filters.from_date) : undefined}
            onValueChange={(date) =>
              setFilter(
                'from_date',
                date ? toLatinDigits(formatDate(date, regionConfig)) : undefined,
              )
            }
          />
          <DatePicker
            aria-label={t('invoices.toDateLabel')}
            config={regionConfig}
            value={filters.to_date ? parseDate(filters.to_date) : undefined}
            onValueChange={(date) =>
              setFilter('to_date', date ? toLatinDigits(formatDate(date, regionConfig)) : undefined)
            }
          />
        </>
      }
      tableId="invoices-list"
      caption={t('invoices.caption')}
      columns={columns}
      data={invoicesQuery.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => {}}
      page={state.page}
      pageSize={state.limit}
      totalCount={invoicesQuery.data?.total ?? 0}
      onPageChange={actions.setPage}
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
