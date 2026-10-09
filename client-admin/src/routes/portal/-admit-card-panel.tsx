import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CreditCardIcon, PhoneIcon, PrinterIcon, RotateCwIcon } from 'lucide-react';

export type AdmitCardState = 'ready' | 'withheld' | 'not-ready';

export interface AdmitCardPanelProps {
  state: AdmitCardState;
  studentName: string;
  onPrint: () => void;
  busy?: boolean;
  feesHref: string;
  /** Already formatted with the region's numerals and currency; absent while dues load or fail. */
  amount?: string | undefined;
  officePhone?: string | null | undefined;
  /** Withheld only: back to the ready state, e.g. once the dues are paid. */
  onRetry?: () => void;
}

export function AdmitCardPanel({
  state,
  studentName,
  onPrint,
  busy = false,
  feesHref,
  amount,
  officePhone,
  onRetry,
}: AdmitCardPanelProps) {
  const { t } = useTranslation('portal');

  if (state === 'not-ready') {
    return (
      <p role="status" className="mx-4 mb-3 text-text-secondary md:mx-5">
        {t('examSchedule.admitCard.notReady')}
      </p>
    );
  }

  if (state === 'withheld') {
    return (
      <div
        role="alert"
        className="mx-4 mb-3 rounded-lg bg-status-due-bg p-4 text-status-due-fg md:mx-5"
      >
        <h3 className="text-label font-semibold">{t('examSchedule.admitCard.withheldTitle')}</h3>
        <p className="mt-1">
          {amount === undefined
            ? t('examSchedule.admitCard.withheldBodyNoAmount', { name: studentName })
            : t('examSchedule.admitCard.withheldBody', { name: studentName, amount })}
        </p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <Button asChild className="min-h-11 w-full md:w-auto">
            <a href={feesHref}>
              <CreditCardIcon aria-hidden="true" />
              {t('examSchedule.admitCard.seeDues')}
            </a>
          </Button>
          {officePhone && (
            <Button asChild variant="outline" className="min-h-11 w-full md:w-auto">
              <a href={`tel:${officePhone}`}>
                <PhoneIcon aria-hidden="true" />
                {t('examSchedule.admitCard.callOffice', { phone: officePhone })}
              </a>
            </Button>
          )}
          {onRetry && (
            <Button variant="outline" onClick={onRetry} className="min-h-11 w-full md:w-auto">
              <RotateCwIcon aria-hidden="true" />
              {t('examSchedule.admitCard.tryAgain')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 flex flex-col gap-3 rounded-lg bg-secondary p-4 md:mx-5 md:flex-row md:items-center md:justify-between">
      <p className="text-secondary-foreground">
        <span className="font-semibold">{t('examSchedule.admitCard.ready')}</span>{' '}
        {t('examSchedule.admitCard.readyHelp')}
      </p>
      <Button onClick={onPrint} loading={busy} className="min-h-11 w-full md:w-auto md:shrink-0">
        <PrinterIcon aria-hidden="true" />
        {t('examSchedule.admitCard.print')}
      </Button>
    </div>
  );
}
