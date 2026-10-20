/**
 * Epic 49 W4: the platform school-detail page's "Seats" card (replaces the retired Trial card):
 * seats bought and used, paid-until, the school's orders, and the grant / record-payment / revive
 * actions. All of it is `SchoolBilling`, shared with the Subscriptions page.
 */
import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { SchoolBilling } from '../../subscriptions/-detail/school-billing';

export interface SeatsCardProps {
  schoolId: string;
  schoolName: string;
}

export function SeatsCard({ schoolId, schoolName }: SeatsCardProps) {
  const { t } = useTranslation('platform');
  return (
    <Card padded>
      <h2 className="text-h2">{t('seats.card.title')}</h2>
      <p className="mt-1 mb-4 text-text-secondary">{t('seats.card.caption')}</p>
      <SchoolBilling schoolId={schoolId} schoolName={schoolName} />
    </Card>
  );
}
