/**
 * [3.x/#3990] Where bKash sends the guardian back (`?id=`). Polls the payment until it leaves
 * PENDING, then says in plain words what happened. The receipt is the existing invoice print
 * (D22, family-scoped); no new PDF and no public link, which only staff can mint.
 */
import { Button, toast } from '@biddaloy/ui/components';
import { openPrintableInvoice, useOnlinePaymentResult } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

const searchSchema = z.object({ id: z.string().uuid().optional().catch(undefined) });

export const Route = createFileRoute('/portal/fees_/pay_/result')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('portalPay', 'common'),
  component: PortalPayResultRoute,
});

function PortalPayResultRoute() {
  return (
    <RegionConfigProvider>
      <PortalPayResultPage />
    </RegionConfigProvider>
  );
}

export function PortalPayResultPage() {
  const { t } = useTranslation('portalPay');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const { id } = Route.useSearch();
  const result = useOnlinePaymentResult(id);
  const goFees = () => void navigate({ to: '/portal/fees' });

  const status = result.data?.status;
  const paid = status === 'COMPLETED' || status === 'CONFIRMED';
  const waiting = status === 'PENDING';
  const receipts = result.data?.receipts ?? [];
  const amount = result.data ? formatServerAmount(result.data.amount, config) : '';

  let body;
  if (!id || result.isError) {
    body = (
      <div className="space-y-3">
        <p role="alert">{t('result.loadError')}</p>
        {id && (
          <Button variant="outline" onClick={() => void result.refetch()}>
            {t('page.retry')}
          </Button>
        )}
      </div>
    );
  } else if (result.isPending) {
    body = <p role="status">{t('result.loading')}</p>;
  } else if (paid) {
    body = (
      <section className="space-y-3">
        <h2 className="text-h2">{t('result.paidTitle')}</h2>
        <p className="text-h3 tabular-nums">
          {receipts.length === 0
            ? amount
            : t('result.receiptLine', { amount, no: receipts.map((r) => r.receiptNo).join(', ') })}
        </p>
        <p className="text-text-secondary">{t('result.paidBody')}</p>
        {result.data?.unmatched && <p role="note">{t('result.unmatched')}</p>}
        <div className="flex flex-wrap gap-3">
          {receipts.map((r) => (
            <Button
              key={r.invoiceId}
              variant="outline"
              onClick={() =>
                void openPrintableInvoice(r.invoiceId, () => toast.error(t('result.printError')))
              }
            >
              {receipts.length > 1 ? `${t('result.receipt')} ${r.receiptNo}` : t('result.receipt')}
            </Button>
          ))}
        </div>
      </section>
    );
  } else if (waiting) {
    body = (
      <section className="space-y-3" role="status">
        <h2 className="text-h2">{t('result.waitingTitle')}</h2>
        <p className="text-text-secondary">{t('result.waitingBody')}</p>
      </section>
    );
  } else {
    body = (
      <section className="space-y-3">
        <h2 className="text-h2">{t('result.failedTitle')}</h2>
        <p className="text-text-secondary">{t('result.failedBody')}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/portal/fees/pay">{t('result.tryAgain')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/portal/fees/pay" search={{ how: 'proof' }}>
              {t('result.submitProof')}
            </Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <FullPageShell
      title={t('result.title')}
      onClose={goFees}
      closeLabel={t('page.close')}
      secondary={{ label: t('result.backToFees'), onClick: goFees }}
    >
      {body}
    </FullPageShell>
  );
}
