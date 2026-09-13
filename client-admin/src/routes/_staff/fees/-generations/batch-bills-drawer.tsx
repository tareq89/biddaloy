/**
 * [16.3.5] The drill-down opened by clicking a batch row in `BatchTable` —
 * lists every bill (`student_fees` row) that batch created.
 *
 * No dedicated "drawer"/"sheet" side-panel primitive exists in
 * `@biddaloy/ui/components` today (only `Dialog`, `Card`) — this uses
 * `Dialog` at a wide `max-w-3xl`, the closest existing design-system
 * primitive, rather than introducing a new one. Flagged in the PR body as
 * a design-system gap: a true slide-in side panel is a `dialog.tsx`-sized
 * addition of its own, out of scope for this ticket.
 */
import {
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useFeeGenerationBills,
  type FeeGeneration,
  type FeeGenerationBill,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface BatchBillsDrawerProps {
  /** The batch to show bills for, or `null` when the drawer is closed —
   * same "row or null" shape `contact-change-dialog.tsx` uses for its own
   * single-record dialog, so closing never needs a separate boolean plus
   * a stale `batch` reference. */
  batch: FeeGeneration | null;
  onOpenChange: (open: boolean) => void;
}

export function BatchBillsDrawer({ batch, onOpenChange }: BatchBillsDrawerProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);
  const limit = 10;

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
      accessorFn: (row) => row.student_full_name,
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
      // `occurrence` is `"<month>/<year>"` (`FeeGenerationBillItemDto`'s
      // own shape) — rendered as "(2)" per the issue's own spec by
      // showing the month number in parens next to the fee name, e.g.
      // "Monthly tuition (9)".
      accessorFn: (row) => `${row.fee_name} (${row.occurrence.split('/')[0]})`,
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
      accessorFn: (row) => row.status,
    },
  ];

  return (
    <Dialog open={batch !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('generations.bills.title')}</DialogTitle>
        </DialogHeader>
        {batch && (
          <DataTable
            tableId="fee-generation-bills"
            caption={t('generations.bills.title')}
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
            emptyMessage={t('generations.bills.emptyMessage')}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
