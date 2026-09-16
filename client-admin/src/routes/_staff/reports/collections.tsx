/**
 * [16.6.4] `/reports/collections` — the cash-close sheet. Tenant-wide
 * fees/payments collections over a date range: totals tiles, three
 * breakdown tables (method / collector / fee type), a by-day bar chart,
 * and a CSV export — all over `GET /reports/collections` (JSON) and
 * `GET /reports/collections.csv` (`ui/src/hooks/reports.ts`).
 *
 * HAND-TYPED CONTRACT: `ui/src/hooks/reports.ts`'s `CollectionsReportResponse`
 * is typed by hand against #671 (w6-g2)'s not-yet-merged endpoints — same
 * pattern wave 5's w5-g2 used against w5-g1's invoice endpoints. Diff
 * against `schema.d.ts` once #671 merges and regenerates it.
 *
 * Date-range presets are computed in Asia/Dhaka using fixed UTC+6
 * arithmetic (Bangladesh has no DST) — the same "plain UTC arithmetic,
 * never a raw `Intl` timezone" convention `attendance/reports.tsx`'s
 * `monthToRange` documents.
 *
 * Not a `ListShell` page: this report is three independent tables plus
 * tiles and a chart, not one paginated list, so it composes `FilterBar` +
 * `useListShellState` (for URL-synced filters only) with plain `DataTable`
 * instances instead.
 */
import { PaymentMethod } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  RoutePending,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useCollectionsReport,
  downloadCollectionsReportCsv,
  type CollectionsByCollector,
  type CollectionsByFeeType,
  type CollectionsByMethod,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
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
  method?: string;
  collector_id?: string;
}

export const Route = createFileRoute('/_staff/reports/collections')({
  loader: () => loadRouteNamespaces('reports', 'common'),
  pendingComponent: CollectionsReportPending,
  component: CollectionsReportPage,
});

function CollectionsReportPending() {
  const { t } = useTranslation('reports');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

function CollectionsReportPage() {
  const { t } = useTranslation('reports');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState();
  const filters = state.filters as CollectionsFilters;
  const preset = (filters.preset as DateRangePreset | undefined) ?? 'today';
  const resolved = preset === 'custom' ? undefined : resolvePresetRange(preset);
  const from = resolved?.from ?? filters.from ?? toIsoDate(dhakaNow());
  const to = resolved?.to ?? filters.to ?? toIsoDate(dhakaNow());

  const reportQuery = useCollectionsReport({
    from,
    to,
    ...(filters.method !== undefined ? { method: filters.method } : {}),
    ...(filters.collector_id !== undefined ? { collector_id: filters.collector_id } : {}),
  });

  const [csvBusy, setCsvBusy] = React.useState(false);
  async function handleDownloadCsv() {
    setCsvBusy(true);
    try {
      await downloadCollectionsReportCsv({
        from,
        to,
        ...(filters.method !== undefined ? { method: filters.method } : {}),
        ...(filters.collector_id !== undefined ? { collector_id: filters.collector_id } : {}),
      });
    } catch {
      toast.error(t('actions.csvDownloadError'));
    } finally {
      setCsvBusy(false);
    }
  }

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
      key: 'method',
      label: t('filters.methodLabel'),
      allLabel: t('filters.allMethods'),
      options: Object.values(PaymentMethod).map((method) => ({
        value: method,
        label: t(`filters.method.${method}`, { defaultValue: method }),
      })),
    },
    {
      kind: 'select',
      key: 'collector_id',
      label: t('filters.collectorLabel'),
      allLabel: t('filters.allCollectors'),
      // [16.6.4 review] Built from the report's own `by_collector` breakdown
      // instead of `GET /users` — that endpoint is ADMIN-only server-side,
      // but this page is also open to ACCOUNTANT/EXECUTIVE, who got a
      // silent 403 and an empty collector filter.
      options: (reportQuery.data?.by_collector ?? []).map((collector) => ({
        value: collector.collector_id,
        label: collector.collector_name,
      })),
    },
  ];

  const data = reportQuery.data;
  const totals = data?.totals;

  // [16.6.4 review] Printed sheet needs to be self-describing — show which
  // method/collector filters (if any) narrowed the totals it's printing.
  const printFilterParts: string[] = [];
  if (filters.method !== undefined) {
    printFilterParts.push(
      `${t('filters.methodLabel')}: ${t(`filters.method.${filters.method}`, {
        defaultValue: filters.method,
      })}`,
    );
  }
  if (filters.collector_id !== undefined) {
    const collectorName =
      data?.by_collector.find((c) => c.collector_id === filters.collector_id)?.collector_name ??
      filters.collector_id;
    printFilterParts.push(`${t('filters.collectorLabel')}: ${collectorName}`);
  }
  const printFilterLabel = printFilterParts.join(', ');

  const methodColumns: DataTableColumn<CollectionsByMethod>[] = [
    { id: 'method', header: t('tables.method'), accessorFn: (row) => row.method },
    {
      id: 'amount',
      header: t('tables.amount'),
      accessorFn: (row) => formatCurrency(row.amount, regionConfig),
      align: 'end',
    },
    {
      id: 'count',
      header: t('tables.count'),
      accessorFn: (row) => formatNumber(row.count, regionConfig),
      align: 'end',
    },
  ];

  const collectorColumns: DataTableColumn<CollectionsByCollector>[] = [
    {
      id: 'collector_name',
      header: t('tables.collector'),
      accessorFn: (row) => row.collector_name,
    },
    {
      id: 'amount',
      header: t('tables.amount'),
      accessorFn: (row) => formatCurrency(row.amount, regionConfig),
      align: 'end',
    },
    {
      id: 'count',
      header: t('tables.count'),
      accessorFn: (row) => formatNumber(row.count, regionConfig),
      align: 'end',
    },
  ];

  const feeTypeColumns: DataTableColumn<CollectionsByFeeType>[] = [
    { id: 'fee_type', header: t('tables.feeType'), accessorFn: (row) => row.fee_type },
    {
      id: 'amount',
      header: t('tables.amount'),
      accessorFn: (row) => formatCurrency(row.amount, regionConfig),
      align: 'end',
    },
    {
      id: 'count',
      header: t('tables.count'),
      accessorFn: (row) => formatNumber(row.count, regionConfig),
      align: 'end',
    },
  ];

  const byDay = data?.by_day ?? [];
  const maxByDay = Math.max(1, ...byDay.map((d) => d.amount));

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{t('title')}</h1>
          {data ? (
            <p className="text-sm text-text-secondary">
              {t('print.range', { from: data.range.from, to: data.range.to })}
              {printFilterLabel ? ` — ${printFilterLabel}` : ''}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleDownloadCsv()}
          disabled={csvBusy || reportQuery.isLoading}
          loading={csvBusy}
          className="print:hidden"
        >
          {t('actions.downloadCsv')}
        </Button>
      </div>

      <div className="print:hidden">
        <FilterBar
          fields={filterFields}
          values={state.filters}
          onChange={(patch) => actions.setFilters(patch)}
        />
      </div>

      {reportQuery.isError ? (
        <p className="text-status-critical text-sm" role="alert">
          {t('errorMessage')}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['collected', t('totals.collected')],
            ['reversed', t('totals.reversed')],
            ['net', t('totals.net')],
            ['standing_discount', t('totals.standingDiscount')],
            ['one_off_discount', t('totals.oneOffDiscount')],
            ['wallet_used', t('totals.walletUsed')],
            ['wallet_added', t('totals.walletAdded')],
            ['change_returned', t('totals.changeReturned')],
          ] as const
        ).map(([key, label]) => (
          <Card key={key} className="flex flex-col gap-1 p-4">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            <span className="text-lg font-semibold text-text-primary">
              {totals ? formatCurrency(totals[key], regionConfig) : '—'}
            </span>
          </Card>
        ))}
      </div>

      <Card className="p-4 print:break-inside-avoid">
        <h2 className="mb-3 text-sm font-medium text-text-primary">{t('chart.title')}</h2>
        {byDay.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('chart.empty')}</p>
        ) : (
          <svg
            role="img"
            aria-label={t('chart.title')}
            viewBox={`0 0 ${byDay.length * 32} 120`}
            className="h-32 w-full"
          >
            {byDay.map((d, i) => {
              const barHeight = Math.max(2, (d.amount / maxByDay) * 100);
              return (
                <rect
                  key={d.date}
                  x={i * 32 + 4}
                  y={110 - barHeight}
                  width={24}
                  height={barHeight}
                  className="fill-brand"
                >
                  <title>
                    {d.date}: {formatCurrency(d.amount, regionConfig)}
                  </title>
                </rect>
              );
            })}
          </svg>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 print:grid-cols-1">
        <DataTable
          tableId="collections-report-by-method"
          caption={t('tables.byMethodCaption')}
          columns={methodColumns}
          data={data?.by_method ?? []}
          getRowId={(row) => row.method}
          sorting={null}
          onSortingChange={() => undefined}
          page={1}
          pageSize={Math.max(1, data?.by_method.length ?? 1)}
          totalCount={data?.by_method.length ?? 0}
          onPageChange={() => undefined}
          loading={reportQuery.isLoading}
          isFetching={reportQuery.isFetching}
          emptyMessage={t('tables.emptyMessage')}
        />
        <DataTable
          tableId="collections-report-by-collector"
          caption={t('tables.byCollectorCaption')}
          columns={collectorColumns}
          data={data?.by_collector ?? []}
          getRowId={(row) => row.collector_id}
          sorting={null}
          onSortingChange={() => undefined}
          page={1}
          pageSize={Math.max(1, data?.by_collector.length ?? 1)}
          totalCount={data?.by_collector.length ?? 0}
          onPageChange={() => undefined}
          loading={reportQuery.isLoading}
          isFetching={reportQuery.isFetching}
          emptyMessage={t('tables.emptyMessage')}
        />
        <DataTable
          tableId="collections-report-by-fee-type"
          caption={t('tables.byFeeTypeCaption')}
          columns={feeTypeColumns}
          data={data?.by_fee_type ?? []}
          getRowId={(row) => row.fee_type}
          sorting={null}
          onSortingChange={() => undefined}
          page={1}
          pageSize={Math.max(1, data?.by_fee_type.length ?? 1)}
          totalCount={data?.by_fee_type.length ?? 0}
          onPageChange={() => undefined}
          loading={reportQuery.isLoading}
          isFetching={reportQuery.isFetching}
          emptyMessage={t('tables.emptyMessage')}
        />
      </div>
    </div>
  );
}
