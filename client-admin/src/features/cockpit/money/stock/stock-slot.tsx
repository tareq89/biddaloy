/**
 * #3885 / D46: the contract #3883 mounts on the SMS state tab. No props. A primary button opens
 * the record dialog (so does `?record=1`, the palette action `sms-stock.record`), then the last
 * 10 purchases and the average cost per SMS.
 *
 * The route file that mounts this must preload the namespace in its `loader:`:
 * `loadRouteNamespaces('moneyStock')` (that file belongs to #3883).
 */
import { Button } from '@biddaloy/ui/components';
import { usePlatformSmsStock } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import { useNavigate, useSearch } from '@tanstack/react-router';
import * as React from 'react';

import { RecordStockDialog } from './record-stock-dialog';
import { StockEntriesList } from './stock-entries-list';

const SHOWN = 10;

export function StockSlot() {
  const { t } = useTranslation('moneyStock');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const wantsRecord = useSearch({ strict: false }).record;
  const [open, setOpen] = React.useState(false);
  const stock = usePlatformSmsStock();
  const entries = (stock.data?.items ?? []).slice(0, SHOWN);

  React.useEffect(() => {
    if (String(wantsRecord) === '1') {
      setOpen(true);
    }
  }, [wantsRecord]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && wantsRecord !== undefined) {
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, record: undefined }),
        replace: true,
      });
    }
  }

  // ponytail: cost per SMS over the entries shown, in whole paisa; a server-side all-time figure if it must cover older purchases.
  const totalSms = entries.reduce((sum, e) => sum + e.smsCount, 0);
  const totalPaisa = entries.reduce((sum, e) => sum + Number(e.costPaisa), 0);
  const average = totalSms > 0 ? formatCurrency(Math.round(totalPaisa / totalSms), config) : null;

  return (
    <section aria-labelledby="stock-slot-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="stock-slot-title" className="text-heading-3 font-semibold">
          {t('title')}
        </h2>
        <Button type="button" onClick={() => setOpen(true)}>
          {t('record')}
        </Button>
      </div>
      <p className="text-body">
        <span className="text-text-secondary">{t('averageCost')}: </span>
        <span className="font-semibold tabular-nums">{average ?? t('averageCostNone')}</span>
        {average && (
          <span className="text-caption text-text-secondary"> ({t('averageCostNote')})</span>
        )}
      </p>
      {stock.isError ? (
        <div role="alert" className="flex items-center gap-3 text-destructive">
          <span>{t('loadError')}</span>
          <Button type="button" variant="outline" onClick={() => void stock.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <StockEntriesList entries={entries} loading={stock.isLoading} />
      )}
      <RecordStockDialog open={open} onOpenChange={onOpenChange} />
    </section>
  );
}
