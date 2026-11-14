import { Button } from '@biddaloy/ui/components';
import type { PaymentOptions } from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

export function PayLine({
  options,
  total,
  config,
}: {
  options: Pick<PaymentOptions, 'onlineEnabled' | 'proofEnabled'> | undefined;
  total: number;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portalPay');
  if (!options) return null;
  if (!options.onlineEnabled && !options.proofEnabled) {
    return <p className="text-text-secondary">{t('dueCard.officeOnly')}</p>;
  }
  return (
    <Button asChild className="w-full md:w-auto">
      <Link to="/portal/fees/pay">
        {t('dueCard.pay', { amount: formatServerAmount(total, config) })}
      </Link>
    </Button>
  );
}
