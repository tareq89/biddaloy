/**
 * [16.6.4] `/reports/collections` — the cash-close sheet. Tenant-wide
 * fees/payments collections over a date range: three totals cards (net is
 * the headline), a discounts/credit card and four small total-bearing
 * breakdown tables (method / collector / fee type / day), printable, plus a
 * CSV export — over `GET /reports/collections` and `.csv`
 * (`ui/src/hooks/reports.ts`, typed from `schema.d.ts`).
 *
 * Date-range presets are computed in Asia/Dhaka using fixed UTC+6
 * arithmetic (Bangladesh has no DST) — the same "plain UTC arithmetic,
 * never a raw `Intl` timezone" convention `attendance/reports.tsx`'s
 * `monthToRange` documents.
 *
 * Not a `ListShell` page: it is four independent tables plus cards, not one
 * paginated list, so it composes `FilterBar` + `useListShellState` (for
 * URL-synced filters only) with plain unpaginated `DataTable`s.
 */
import { PaymentMethod } from '@biddaloy/shared';
import {
  Card,
  DataTable,
  ErrorState,
  RoutePending,
  Skeleton,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useCollectionsReport,
  downloadCollectionsReportCsv,
  type CollectionsByCollector,
  type CollectionsByDay,
  type CollectionsByFeeType,
  type CollectionsByMethod,
  type CollectionsReportFilters,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  useListShellState,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatDate, formatDateRange, formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { DownloadIcon, PrinterIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

const DHAKA_OFFSET_MS = 6 * 60 * 60_000;

/** Present a UTC timestamp shifted to Dhaka's fixed UTC+6 wall clock, then
 * read its UTC getters — the exact "shift, then read UTC fields" trick
 * `attendance/reports.tsx`'s `monthToRange` uses, so the calendar day
 * this resolves never depends on the machine's local timezone. */
function dhakaNow(): Date {
  return new Date(Date.now() + DHAKA_OFFSET_MS);
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export type DateRangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

/** Resolves a preset into an inclusive `[from, to]` Dhaka-calendar-day
 * range. `'custom'` is not resolved here — the caller falls back to the
 * `from`/`to` filter values instead. */
export function resolvePresetRange(
  preset: DateRangePreset,
  now: Date = dhakaNow(),
): { from: string; to: string } {
  const today = toIsoDate(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = toIsoDate(addDays(now, -1));
      return { from: y, to: y };
    }
    case 'week': {
      // ISO week: Monday start. `getUTCDay()` 0=Sunday..6=Saturday.
      const dow = now.getUTCDay();
      const offsetFromMonday = dow === 0 ? 6 : dow - 1;
      return { from: toIsoDate(addDays(now, -offsetFromMonday)), to: today };
    }
    case 'month': {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: toIsoDate(first), to: today };
    }
    case 'custom':
      return { from: today, to: today };
  }
}

interface CollectionsFilters {
  preset?: string;
  from?: string;
  to?: string;
  payment_method?: string;
  received_by_user_id?: string;
}

export const Route = createFileRoute('/_staff/reports/collections')({
  loader: () => loadRouteNamespaces('reports', 'feeStructures', 'common'),
  pendingComponent: CollectionsReportPending,
  component: CollectionsReportPage,
});

function CollectionsReportPending() {
  const { t } = useTranslation('reports');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_METHODS: readonly string[] = Object.values(PaymentMethod);

function CollectionsReportPage() {
  const { t } = useTranslation('reports');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState();
  const filters = state.filters as CollectionsFilters;
  const preset = (filters.preset as DateRangePreset | undefined) ?? 'today';
  const resolved = preset === 'custom' ? undefined : resolvePresetRange(preset);
  const from = resolved?.from ?? filters.from ?? toIsoDate(dhakaNow());
  const to = resolved?.to ?? filters.to ?? toIsoDate(dhakaNow());

  const reportFilters: CollectionsReportFilters = {
    from,
    to,
    ...(filters.payment_method !== undefined && PAYMENT_METHODS.includes(filters.payment_method)
      ? {
          payment_method: filters.payment_method as NonNullable<
            CollectionsReportFilters['payment_method']
          >,
        }
      : {}),
    ...(filters.received_by_user_id !== undefined && UUID_RE.test(filters.received_by_user_id)
      ? { received_by_user_id: filters.received_by_user_id }
      : {}),
  };
  const reportQuery = useCollectionsReport(reportFilters);

  const [csvBusy, setCsvBusy] = React.useState(false);
  async function handleDownloadCsv() {
    setCsvBusy(true);
    try {
      await downloadCollectionsReportCsv(reportFilters);
    } catch {
      toast.error(t('actions.csvDownloadError'));
    } finally {
      setCsvBusy(false);
    }
  }

  const data = reportQuery.data;
  const totals = data?.totals;
  const loading = reportQuery.isLoading;
  const money = (amount: number) => formatServerAmount(amount, regionConfig);
  const count = (n: number) => formatNumber(n, regionConfig);

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'preset',
      label: t('filters.presetLabel'),
      allLabel: t('filters.presetToday'),
      options: [
        { value: 'yesterday', label: t('filters.presetYesterday') },
        { value: 'week', label: t('filters.presetWeek') },
        { value: 'month', label: t('filters.presetMonth') },
        { value: 'custom', label: t('filters.presetCustom') },
      ],
    },
    // [16.6.4 review] Only rendered for the 'custom' preset — otherwise the
    // pickers sat there always-editable but silently ignored, since `from`/
    // `to` only feed the query when `preset === 'custom'` above.
    ...(preset === 'custom'
      ? ([
          {
            kind: 'date-range',
            fromKey: 'from',
            toKey: 'to',
            label: t('filters.customRangeLabel'),
            fromLabel: t('filters.fromLabel'),
            toLabel: t('filters.toLabel'),
          },
        ] as FilterFieldDescriptor[])
      : []),
    {
      kind: 'select',
      key: 'payment_method',
      label: t('filters.methodLabel'),
      allLabel: t('filters.allMethods'),
      options: Object.values(PaymentMethod).map((method) => ({
        value: method,
        label: t(`filters.method.${method}`, { defaultValue: method }),
      })),
    },
    {
      kind: 'select',
      key: 'received_by_user_id',
      label: t('filters.collectorLabel'),
      allLabel: t('filters.allCollectors'),
      // [16.6.4 review] Built from the report's own `by_collector` breakdown
      // instead of `GET /users` — that endpoint is ADMIN-only server-side,
      // but this page is also open to ACCOUNTANT/EXECUTIVE, who got a
      // silent 403 and an empty collector filter.
      options: (data?.by_collector ?? []).flatMap((c) =>
        c.user_id === null
          ? []
          : [{ value: c.user_id, label: c.full_name ?? t('tables.unknownCollector') }],
      ),
    },
  ];

  const methodLabel = (method: string) => t(`filters.method.${method}`, { defaultValue: method });
  const subtitle = [
    formatDateRange(from, to, regionConfig),
    reportFilters.payment_method
      ? methodLabel(reportFilters.payment_method)
      : t('subtitleAllMethods'),
    reportFilters.received_by_user_id
      ? (data?.by_collector.find((c) => c.user_id === reportFilters.received_by_user_id)
          ?.full_name ?? t('subtitleAllCollectors'))
      : t('subtitleAllCollectors'),
  ].join(' · ');

  // First column: name, plus (phone only) the two-line caption; other
  // columns are hidden in card mode except the right-hand figure.
  const nameCell = (name: string, caption: string) => (
    <span className="flex flex-col">
      <span>{name}</span>
      <span className="text-caption text-text-secondary md:hidden">{caption}</span>
    </span>
  );

  const methodColumns: DataTableColumn<CollectionsByMethod>[] = [
    {
      id: 'method',
      header: t('tables.method'),
      accessorFn: (row) =>
        nameCell(
          methodLabel(row.payment_method),
          t('tables.rowCaption', {
            count: row.count,
            n: count(row.count),
            amount: money(row.reversed),
          }),
        ),
    },
    {
      id: 'count',
      header: t('tables.entries'),
      accessorFn: (row) => count(row.count),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'collected',
      header: t('tables.collected'),
      accessorFn: (row) => money(row.collected),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'reversed',
      header: t('tables.reversed'),
      accessorFn: (row) => money(row.reversed),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'net',
      header: t('tables.net'),
      accessorFn: (row) => money(row.net),
      align: 'end',
      card: 'badge',
    },
  ];

  const collectorColumns: DataTableColumn<CollectionsByCollector>[] = [
    {
      id: 'collector',
      header: t('tables.collector'),
      accessorFn: (row) =>
        nameCell(
          row.full_name ?? t('tables.unknownCollector'),
          t('tables.rowCaption', {
            count: row.count,
            n: count(row.count),
            amount: money(row.reversed),
          }),
        ),
    },
    {
      id: 'count',
      header: t('tables.entries'),
      accessorFn: (row) => count(row.count),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'collected',
      header: t('tables.collected'),
      accessorFn: (row) => money(row.collected),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'reversed',
      header: t('tables.reversed'),
      accessorFn: (row) => money(row.reversed),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'net',
      header: t('tables.net'),
      accessorFn: (row) => money(row.net),
      align: 'end',
      card: 'badge',
    },
  ];

  const feeTypeColumns: DataTableColumn<CollectionsByFeeType>[] = [
    {
      id: 'fee_type',
      header: t('tables.feeType'),
      accessorFn: (row) =>
        nameCell(
          t(`feeTypes.${row.fee_type}`, { ns: 'feeStructures', defaultValue: row.fee_type }),
          `${t('tables.discount')} ${money(row.discount)}`,
        ),
    },
    {
      id: 'discount',
      header: t('tables.discount'),
      accessorFn: (row) => money(row.discount),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'collected',
      header: t('tables.collected'),
      accessorFn: (row) => money(row.collected),
      align: 'end',
      card: 'badge',
    },
  ];

  const dayColumns: DataTableColumn<CollectionsByDay>[] = [
    {
      id: 'date',
      header: t('tables.date'),
      accessorFn: (row) =>
        nameCell(
          formatDate(row.date, regionConfig),
          `${t('tables.collected')} ${money(row.collected)} · ${t('tables.reversed')} ${money(row.reversed)}`,
        ),
    },
    {
      id: 'collected',
      header: t('tables.collected'),
      accessorFn: (row) => money(row.collected),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'reversed',
      header: t('tables.reversed'),
      accessorFn: (row) => money(row.reversed),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'net',
      header: t('tables.net'),
      accessorFn: (row) => money(row.net),
      align: 'end',
      card: 'badge',
    },
  ];

  const tableProps = {
    sorting: null,
    onSortingChange: () => undefined,
    paginated: false,
    loading,
    isFetching: reportQuery.isFetching,
    emptyState: {
      title: t('tables.emptyMessage'),
      explanation: t('tables.emptyExplanation'),
    },
  } as const;

  const section = (title: string, help: string, table: React.ReactNode): React.ReactElement => (
    <Card className="overflow-hidden print:break-inside-avoid">
      <div className="p-4 md:p-5">
        <h2 className="text-h2">{title}</h2>
        <p className="mt-1 text-text-secondary">{help}</p>
      </div>
      {table}
    </Card>
  );

  const value = (amount: number | undefined, className: string) =>
    loading || amount === undefined ? (
      <Skeleton className="mt-1 h-7 w-32" />
    ) : (
      <p className={className}>{money(amount)}</p>
    );

  return (
    <PageContainer>
      {/* PageHeader has no print hook yet: hide its buttons here so title + subtitle still print. */}
      <div className="print:[&_button]:hidden">
        <PageHeader
          title={t('title')}
          subtitle={subtitle}
          actions={[
            {
              id: 'csv',
              label: t('actions.downloadCsv'),
              icon: <DownloadIcon aria-hidden className="size-4" />,
              priority: 'secondary',
              onClick: () => void handleDownloadCsv(),
              disabled: loading,
              busy: csvBusy,
            },
            {
              id: 'print',
              label: t('actions.print'),
              icon: <PrinterIcon aria-hidden className="size-4" />,
              priority: 'primary',
              onClick: () => window.print(),
            },
          ]}
        />
      </div>
      <div className="print:hidden">
        <FilterBar
          fields={filterFields}
          values={state.filters}
          onChange={(patch) => actions.setFilters(patch)}
        />
      </div>

      {reportQuery.isError ? (
        <ErrorState message={t('errorMessage')} onRetry={() => void reportQuery.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
            <Card padded>
              <h2 className="text-label text-text-secondary">{t('totals.collected')}</h2>
              {value(totals?.collected, 'mt-1 text-h2 md:text-h1 tabular-nums')}
            </Card>
            <Card padded>
              <h2 className="text-label text-text-secondary">{t('totals.reversed')}</h2>
              {value(totals?.reversed, 'mt-1 text-h2 md:text-h1 tabular-nums')}
              <p className="mt-0.5 text-caption text-text-secondary">{t('totals.reversedHelp')}</p>
            </Card>
            <Card padded className="order-first col-span-2 md:order-last md:col-span-1">
              <h2 className="text-label text-text-secondary">{t('totals.net')}</h2>
              {value(totals?.net, 'mt-1 text-h1 text-primary tabular-nums')}
              <p className="mt-0.5 text-caption text-text-secondary">{t('totals.netHelp')}</p>
            </Card>
          </div>

          <Card padded>
            <h2 className="text-h3">{t('totals.otherTitle')}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
              {(
                [
                  ['standing_discount', t('totals.standingDiscount')],
                  ['one_off_discount', t('totals.oneOffDiscount')],
                  ['wallet_used', t('totals.walletUsed')],
                  ['wallet_added', t('totals.walletAdded')],
                  ['change_returned', t('totals.changeReturned')],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt className="text-caption text-text-secondary">{label}</dt>
                  <dd className="font-medium tabular-nums">{totals ? money(totals[key]) : '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <div className="grid items-start gap-6 md:grid-cols-2 print:grid-cols-1">
            {section(
              t('tables.byMethodTitle'),
              t('tables.byMethodHelp'),
              <DataTable
                {...tableProps}
                tableId="collections-report-by-method"
                caption={t('tables.byMethodTitle')}
                columns={methodColumns}
                data={data?.by_method ?? []}
                getRowId={(row) => row.payment_method}
                totalCount={data?.by_method.length ?? 0}
              />,
            )}
            {section(
              t('tables.byCollectorTitle'),
              t('tables.byCollectorHelp'),
              <DataTable
                {...tableProps}
                tableId="collections-report-by-collector"
                caption={t('tables.byCollectorTitle')}
                columns={collectorColumns}
                data={data?.by_collector ?? []}
                getRowId={(row) => row.user_id ?? 'unknown'}
                totalCount={data?.by_collector.length ?? 0}
              />,
            )}
            {section(
              t('tables.byFeeTypeTitle'),
              t('tables.byFeeTypeHelp'),
              <DataTable
                {...tableProps}
                tableId="collections-report-by-fee-type"
                caption={t('tables.byFeeTypeTitle')}
                columns={feeTypeColumns}
                data={data?.by_fee_type ?? []}
                getRowId={(row) => row.fee_type}
                totalCount={data?.by_fee_type.length ?? 0}
              />,
            )}
            {section(
              t('tables.byDayTitle'),
              t('tables.byDayHelp'),
              <DataTable
                {...tableProps}
                tableId="collections-report-by-day"
                caption={t('tables.byDayTitle')}
                columns={dayColumns}
                data={data?.by_day ?? []}
                getRowId={(row) => row.date}
                totalCount={data?.by_day.length ?? 0}
              />,
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}
