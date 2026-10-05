/**
 * [28.4.3] Portal home card: "N surveys waiting", one tap to `/portal/surveys`.
 * Renders nothing while loading, on error, or when nothing is pending: the
 * home page must never be blocked or cluttered by an optional card.
 */
import { Card } from '@biddaloy/ui/components';
import { useMySurveys } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, ClipboardListIcon } from 'lucide-react';

export function PortalSurveysCard() {
  const { t } = useTranslation('evaluations');
  const { data } = useMySurveys();
  // `mine` only lists surveys that still have a pending pair.
  const count = data?.length ?? 0;
  if (count === 0) return null;

  return (
    <Card asChild>
      <Link
        to="/portal/surveys"
        className="flex min-h-11 items-center gap-3 p-4 hover:bg-muted md:p-5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <ClipboardListIcon className="size-5" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{t('portalSurveys.cardWaiting', { count })}</span>
          <span className="text-text-secondary">{t('portalSurveys.cardAction')}</span>
        </span>
        <ChevronRightIcon aria-hidden="true" className="size-4 text-text-secondary" />
      </Link>
    </Card>
  );
}
