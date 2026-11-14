/**
 * #3885 The last purchases, newest first, with a per-row delete. Delete asks for a reason, then
 * `useDeleteSmsStock` (a `useApprovedMutation`, scope `platform.sms_stock`) opens the code prompt.
 * `ConfirmDialog` has no field slot, so the reason dialog is a plain `Dialog` like Archive school.
 * A failure shows one fixed sentence, never the server text or the typed reason (Rule 23).
 */
import {
  Button,
  DataTable,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useDeleteSmsStock, type SmsStockEntry } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface StockEntriesListProps {
  entries: SmsStockEntry[];
  loading?: boolean;
}

export function StockEntriesList({ entries, loading }: StockEntriesListProps) {
  const { t } = useTranslation('moneyStock');
  const config = useRegionConfig();
  const del = useDeleteSmsStock();
  const [target, setTarget] = React.useState<SmsStockEntry | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState(false);

  const columns: DataTableColumn<SmsStockEntry>[] = [
    { id: 'boughtOn', header: t('list.date'), accessorFn: (r) => r.boughtOn, card: 'title' },
    {
      id: 'smsCount',
      header: t('list.smsCount'),
      accessorFn: (r) => formatNumber(r.smsCount, config),
      align: 'end',
    },
    {
      id: 'cost',
      header: t('list.cost'),
      accessorFn: (r) => formatCurrency(Number(r.costPaisa), config),
      align: 'end',
    },
    { id: 'note', header: t('list.note'), accessorFn: (r) => r.note ?? '' },
  ];

  function close() {
    if (del.isPending) return;
    setTarget(null);
    setReason('');
    setReasonError(false);
    del.reset();
  }

  function confirm() {
    if (!target) return;
    if (reason.trim().length < 5) {
      setReasonError(true);
      return;
    }
    del.mutate(
      { id: target.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('delete.done'));
          setTarget(null);
          setReason('');
        },
      },
    );
  }

  return (
    <>
      <DataTable
        tableId="money-stock-entries"
        caption={t('list.caption')}
        columns={columns}
        data={entries}
        getRowId={(r) => r.id}
        sorting={null}
        onSortingChange={() => undefined}
        totalCount={entries.length}
        paginated={false}
        loading={loading ?? false}
        emptyState={{ title: t('empty.title'), explanation: t('empty.description') }}
        rowActions={(row) => [
          { intent: 'delete', label: t('list.delete'), onClick: () => setTarget(row) },
        ]}
      />
      <Dialog open={target !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent size="sm" showCloseButton={!del.isPending}>
          <DialogHeader>
            <DialogTitle>{t('delete.title')}</DialogTitle>
            <DialogDescription>{t('delete.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="stock-delete-reason">{t('delete.reason')}</Label>
            <Textarea
              id="stock-delete-reason"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(false);
              }}
            />
            {reasonError && (
              <p role="alert" className="text-caption text-destructive">
                {t('delete.reasonLength')}
              </p>
            )}
            {del.isError && (
              <p role="alert" className="text-caption text-destructive">
                {t('delete.errors.generic')}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={del.isPending}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="button" variant="danger" loading={del.isPending} onClick={confirm}>
              {t('delete.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
