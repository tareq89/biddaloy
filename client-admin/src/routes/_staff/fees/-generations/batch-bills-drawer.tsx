/**
 * [16.3.5] The drill-down opened by a batch's "View bills" action in
 * `BatchTable` — lists every bill (`student_fees` row) that batch created.
 *
 * A `Dialog` `lg` by design: a read-only view, not a form (D21).
 */
import { FeeStatus } from '@biddaloy/shared';
import {
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useFeeGenerationBills,
  type FeeGeneration,
  type FeeGenerationBill,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatMonth, formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import * as React from 'react';

import { formatBatchPeriod } from './batch-table';

export interface BatchBillsDrawerProps {
  /** The batch to show bills for, or `null` when the drawer is closed —
   * same "row or null" shape `contact-change-dialog.tsx` uses for its own
   * single-record dialog, so closing never needs a separate boolean plus
   * a stale `batch` reference. */
  batch: FeeGeneration | null;
  onOpenChange: (open: boolean) => void;
}

/** `"3/2026"` → `"2026-03"`. */
function toMonthKey(occurrence: string): string {
  const [month = '', year = ''] = occurrence.split('/');
  return `${year}-${month.padStart(2, '0')}`;
}

export function BatchBillsDrawer({ batch, onOpenChange }: BatchBillsDrawerProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);
  const limit = 25;

  // Resets back to page 1 whenever a different batch opens — otherwise a
  // drawer left on page 3 for one batch would open the next batch already
  // scrolled past its own first page.
  React.useEffect(() => {
    setPage(1);
  }, [batch?.id]);

  const billsQuery = useFeeGenerationBills(batch?.id, { page, limit });
  const rows = billsQuery.data?.data ?? [];

  const columns: DataTableColumn<FeeGenerationBill>[] = [
    {
      id: 'student',
      header: t('generations.bills.columnStudent'),
      accessorFn: (row) => (
        <span className="flex flex-col">
          <span>{row.student_full_name}</span>
          {row.student_registration_number && (
            <span className="text-caption text-text-secondary">
              {row.student_registration_number}
            </span>
          )}
        </span>
      ),
      card: 'title',
    },
    {
      id: 'class',
      header: t('generations.bills.columnClass'),
      accessorFn: (row) => row.class_name ?? t('generations.bills.noClass'),
    },
    {
      id: 'fee',
      header: t('generations.bills.columnFee'),
      // `occurrence` is `"<month>/<year>"` (`FeeGenerationBillItemDto`'s own shape).
      accessorFn: (row) =>
        `${row.fee_name} · ${formatMonth(toMonthKey(row.occurrence), regionConfig)}`,
    },
    {
      id: 'amount',
      header: t('generations.bills.columnAmount'),
      accessorFn: (row) => formatServerAmount(row.amount, regionConfig),
      align: 'end',
    },
    {
      id: 'paid',
      header: t('generations.bills.columnPaid'),
      accessorFn: (row) => formatServerAmount(row.paid_amount, regionConfig),
      align: 'end',
    },
    {
      id: 'status',
      header: t('generations.bills.columnStatus'),
      accessorFn: (row) =>
        Object.values(FeeStatus).includes(row.status as FeeStatus) ? (
          <StatusBadge domain="fee" status={row.status as FeeStatus} />
        ) : (
          '—'
        ),
      card: 'badge',
    },
  ];

  const period = batch ? formatBatchPeriod(batch, regionConfig) : '';

  return (
    <Dialog open={batch !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('generations.bills.titleWithPeriod', { period })}</DialogTitle>
          {batch && (
            <DialogDescription>
              {t('generations.bills.summary', {
                students: formatNumber(batch.student_count, regionConfig),
                amount: formatServerAmount(batch.billed_amount, regionConfig),
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        {batch && (
          <DataTable
            tableId="fee-generation-bills"
            caption={t('generations.bills.titleWithPeriod', { period })}
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            sorting={null}
            onSortingChange={() => {}}
            page={page}
            pageSize={limit}
            totalCount={billsQuery.data?.total ?? 0}
            onPageChange={setPage}
            loading={billsQuery.isLoading}
            isFetching={billsQuery.isFetching}
            {...(billsQuery.isError ? { error: t('generations.bills.errorMessage') } : {})}
            emptyState={{
              title: t('generations.bills.emptyMessage'),
              explanation: t('generations.bills.emptyExplanation'),
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
