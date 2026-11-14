/**
 * [100.4.02] The buy side of the SMS credit section: what is left and when each part ends, the
 * unmasked note, the packages, and the buy dialog. Everything about a package (name, count, price,
 * validity) comes from the server. A school on its own SMS company still sees the packages; a Buy
 * press first offers the switch (D9).
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ErrorState,
  LotExpiryList,
  NoticeBar,
  PackageCard,
} from '@biddaloy/ui/components';
import { useSmsBundleCatalog, type SmsCreditsResponse } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { BuySmsBundleFlow } from './BuySmsBundleDialog';
import { SmsSourceCard } from './SmsSourceCard';

const SOON_DAYS = 7;

export interface SmsBundlesPanelProps {
  credits: SmsCreditsResponse;
  /** SUPER_ADMIN's picked-school view: read only. */
  canBuy: boolean;
  /** `?smsBuy=1`: open the buy dialog on arrival. */
  openBuy?: boolean;
  /** Called when a dialog opened by `openBuy` closes, so the caller can drop the param. */
  onBuyClosed?: () => void;
  /** `?smsOrder=<id>`: the order bKash sent the admin back for. */
  returnOrderId?: string | undefined;
  payment?: 'success' | 'cancel' | 'failure' | 'error' | undefined;
  pollTimedOut?: boolean;
  /** Test/story clock. */
  now?: Date;
}

export function SmsBundlesPanel({
  credits,
  canBuy,
  openBuy = false,
  onBuyClosed,
  returnOrderId,
  payment,
  pollTimedOut = false,
  now = new Date(),
}: SmsBundlesPanelProps) {
  const { t } = useTranslation('smsBundles');
  const config = useRegionConfig();
  const catalog = useSmsBundleCatalog();
  const packages = catalog.data ?? [];
  const [selectedId, setSelectedId] = React.useState<string>();
  const [buyOpen, setBuyOpen] = React.useState(false);
  const [switchOpen, setSwitchOpen] = React.useState(false);
  const own = credits.source === 'OWN';
  const selected = packages.find((p) => p.id === selectedId);

  function start(id: string) {
    setSelectedId(id);
    if (own) setSwitchOpen(true);
    else setBuyOpen(true);
  }

  // `?smsBuy=1` (red notice, palette) starts with the cheapest package: the catalog is cheapest first.
  const first = packages[0];
  const sawBuyLink = React.useRef(false);
  React.useEffect(() => {
    if (!openBuy) sawBuyLink.current = false;
    else if (canBuy && first && !sawBuyLink.current) {
      sawBuyLink.current = true;
      start(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `start` only sets state
  }, [openBuy, canBuy, first?.id]);

  function closeBuy() {
    setBuyOpen(false);
    setSwitchOpen(false);
    if (openBuy) onBuyClosed?.();
  }

  const lotRows = [...credits.lots]
    .filter((l) => l.remaining > 0)
    .sort((a, b) => (a.expires_at ?? '9999').localeCompare(b.expires_at ?? '9999'))
    .map((l) => ({
      id: l.id,
      remainingLabel: t('lots.left', { n: formatNumber(l.remaining, config) }),
      expiryLabel: l.expires_at ? formatDate(new Date(l.expires_at), config) : null,
      soon:
        l.expires_at !== null &&
        new Date(l.expires_at).getTime() - now.getTime() <= SOON_DAYS * 86_400_000,
    }));

  const returnOrder = returnOrderId
    ? credits.orders.find((o) => o.id === returnOrderId)
    : undefined;
  const returnKey = ((): string | undefined => {
    if (!returnOrderId) return undefined;
    if (returnOrder?.status === 'PAID') return 'paid';
    if (payment === 'error') return 'error';
    if (
      payment === 'cancel' ||
      payment === 'failure' ||
      (returnOrder && returnOrder.status !== 'PENDING_PAYMENT')
    )
      return 'failed';
    return pollTimedOut ? 'slow' : 'pending';
  })();

  return (
    <div className="mt-6 grid gap-4">
      {returnKey && (
        <NoticeBar tone={returnKey === 'paid' || returnKey === 'pending' ? 'info' : 'warning'}>
          <span role="status">{t(`return.${returnKey}`)}</span>
        </NoticeBar>
      )}
      <div>
        <h3 className="text-h3">{t('lots.title')}</h3>
        <LotExpiryList
          rows={lotRows}
          noExpiryLabel={t('lots.noExpiry')}
          soonLabel={t('lots.soon')}
          emptyText={t('lots.empty')}
        />
      </div>
      <p className="text-sm text-text-secondary">{t('unmaskedNote')}</p>
      {canBuy && (
        <div>
          <h3 className="text-h3">{t('packages.title')}</h3>
          {catalog.isError ? (
            <ErrorState
              message={t('packages.loadError')}
              retryLabel={t('actions.retry', { ns: 'common' })}
              onRetry={() => void catalog.refetch()}
            />
          ) : packages.length === 0 && !catalog.isLoading ? (
            <p className="mt-2 text-sm text-text-secondary">{t('packages.empty')}</p>
          ) : (
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              {packages.map((p) => (
                <PackageCard
                  key={p.id}
                  name={p.name}
                  smsCount={t('packages.sms', { n: formatNumber(p.smsCount, config) })}
                  priceLabel={formatCurrency(Number(p.pricePaisa), config)}
                  validityLabel={t('packages.validity', {
                    days: formatNumber(p.validityDays, config),
                  })}
                  buyLabel={t('packages.buy')}
                  onBuy={() => start(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <Dialog open={switchOpen} onOpenChange={(o) => (o ? setSwitchOpen(true) : closeBuy())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="sr-only">{t('source.title')}</DialogTitle>
          </DialogHeader>
          <SmsSourceCard
            onCancel={closeBuy}
            onSwitched={() => {
              setSwitchOpen(false);
              setBuyOpen(true);
            }}
          />
        </DialogContent>
      </Dialog>
      {selected && (
        <BuySmsBundleFlow
          key={selected.id}
          open={buyOpen}
          onOpenChange={(o) => (o ? setBuyOpen(true) : closeBuy())}
          packages={packages}
          selected={selected}
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}
