/** Seat plan status as a coloured badge — used by the list and the plan detail. */
import { StatusBadge } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export function SeatPlanStatusBadge({
  status,
  ns = 'seatPlans',
}: {
  status: 'DRAFT' | 'PUBLISHED';
  /** Namespace holding `status.DRAFT` / `status.PUBLISHED`. */
  ns?: string;
}) {
  const { t } = useTranslation(ns);
  return (
    <StatusBadge tone={status === 'PUBLISHED' ? 'success' : 'neutral'} label={t(`status.${status}`)} />
  );
}
