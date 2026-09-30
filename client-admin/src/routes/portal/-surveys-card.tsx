/**
 * [28.4.3] Portal home card: "N surveys waiting", one tap to `/portal/surveys`.
 * Renders nothing while loading, on error, or when nothing is pending: the
 * home page must never be blocked or cluttered by an optional card.
 */
import { Card } from '@biddaloy/ui/components';
import { useMySurveys } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';

export function PortalSurveysCard() {
  const { t } = useTranslation('evaluations');
  const { data } = useMySurveys();
  // `mine` only lists surveys that still have a pending pair.
  const count = data?.length ?? 0;
  if (count === 0) return null;

  return (
    <Card asChild>
      <Link to="/portal/surveys" className="flex min-h-11 items-center justify-between gap-3 p-4">
        <span className="flex flex-col">
          <span className="text-sm font-semibold">{t('portalSurveys.cardWaiting', { count })}</span>
          <span className="text-xs text-muted-foreground">{t('portalSurveys.cardAction')}</span>
        </span>
        <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      </Link>
    </Card>
  );
}
